"use client";
import { deleteCookie, getCookie } from "cookies-next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function AudioCall() {
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [transcriptions, setTranscriptions] = useState<
    { text: string; sender: string }[]
  >([]);

  const router = useRouter();

  useEffect(() => {
    socketRef.current = io(
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000",
      {
        auth: {
          token: getCookie("token"),
        },
        extraHeaders: { "ngrok-skip-browser-warning": "true" },
      }
    );

    // Receive audio from other participants
    socketRef.current.on("incoming-audio", (data) => {
      // Ensure we are passing only the string
      const base64String = typeof data === "string" ? data : data.audio;
      if (base64String) {
        console.log(base64String);
        playTranslatedAudio(base64String);
        console.log(data.text);
      }
    });

    // Listen for transcription updates
    socketRef.current.on(
      "new-transcription",
      (data: { text: string; sender: string }) => {
        console.log({ data });
        setTranscriptions((prev) => [...prev, data]);
      }
    );

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const startAudio = async (currentRoomId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
      audioCtxRef.current = audioCtx;

      if (audioCtx.state === "suspended") await audioCtx.resume();

      // 1. Load the Worklet module from the public folder
      await audioCtx.audioWorklet.addModule("/pcm-processor.js");

      const source = audioCtx.createMediaStreamSource(stream);

      // 2. Create the Worklet Node
      const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");

      // 3. Listen for PCM data coming from the Worklet
      workletNode.port.onmessage = (event) => {
        const pcmBuffer = event.data;

        // Safe Base64 encoding
        const binary = String.fromCharCode(...new Uint8Array(pcmBuffer));
        const base64 = window.btoa(binary);

        // Emit to server
        socketRef.current?.emit("audio-chunk", {
          roomId: currentRoomId,
          audio: base64,
        });
      };

      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      console.log("🎙️ AudioWorklet active (Lower latency)...");
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const playTranslatedAudio = (base64: string) => {
    try {
      // 1. Clean the string
      const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;

      // 2. Convert to Blob
      const binary = window.atob(cleanBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);

      // 3. Play using standard Audio element
      const audio = new Audio(url);

      // This often works even if AudioContext is suspended
      // because the user already "interacted" by joining the room
      audio.play().catch((err) => {
        console.error(
          "Playback failed. User may need to click the page again:",
          err
        );
        // Fallback: If it fails, try to resume the context one more time
        audioCtxRef.current?.resume();
      });

      // 4. Cleanup memory
      audio.onended = () => URL.revokeObjectURL(url);

      console.log("🔊 Playing AI voice...");
    } catch (error) {
      console.error("Decoding Error:", error);
    }
  };

  const handleJoin = () => {
    if (!roomId) return alert("Please enter a Room ID");

    setIsJoined(true);
    socketRef.current?.emit("join-room", roomId);
    startAudio(roomId);
  };

  const handlelogout = () => {
    deleteCookie("token");
    router.push("/login");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white">
      <div className="p-8 bg-slate-800 rounded-xl border border-slate-700 w-80 text-center">
        <h1 className="text-xl font-bold mb-4">Voice Call Room</h1>
        {!isJoined ? (
          <>
            <input
              className="w-full p-2 mb-4 bg-slate-700 rounded border border-slate-600 focus:outline-none focus:border-blue-500"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button
              onClick={handleJoin}
              className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition-colors"
            >
              Start Call
            </button>
            <button
              className="text-white bg-red-500 p-4 rounded-lg"
              onClick={handlelogout}
            >
              Logout
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-emerald-400 text-center font-bold">
              ● Live in {roomId}
            </div>

            <div className="h-64 overflow-y-auto bg-slate-900 p-4 rounded border border-slate-700 text-sm">
              <p className="text-slate-500 mb-2 italic text-xs">
                Transcriptions will appear here...
              </p>
              {transcriptions.map((t, i) => (
                <div key={i} className="mb-2">
                  <span className="text-blue-400 font-bold">
                    {t.sender === socketRef.current?.id ? "You" : "Them"}:{" "}
                  </span>
                  <span>{t.text}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => window.location.reload()}
              className="text-xs text-slate-500 underline"
            >
              Leave Call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
