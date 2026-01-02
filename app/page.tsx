"use client";
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
  const roomIdRef = useRef("");

  useEffect(() => {
    socketRef.current = io(
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000",
      { extraHeaders: { "ngrok-skip-browser-warning": "true" } }
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

  // commit

  // const startAudio = async (currentRoomId: string) => {
  //   try {
  //     const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  //     // Initialize Audio Context at 24kHz (or 44.1/48k for higher quality)
  //     const audioCtx = new (window.AudioContext ||
  //       (window as any).webkitAudioContext)({
  //       sampleRate: 24000,
  //     });
  //     audioCtxRef.current = audioCtx;

  //     if (audioCtx.state === "suspended") await audioCtx.resume();

  //     const source = audioCtx.createMediaStreamSource(stream);
  //     const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  //     processor.onaudioprocess = (e) => {
  //       const inputData = e.inputBuffer.getChannelData(0);

  //       // Convert Float32 to Int16 PCM
  //       const pcm16 = new Int16Array(inputData.length);
  //       for (let i = 0; i < inputData.length; i++) {
  //         const s = Math.max(-1, Math.min(1, inputData[i]));
  //         pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  //       }

  //       // Safe Base64 encoding
  //       const binary = String.fromCharCode(...new Uint8Array(pcm16.buffer));
  //       const base64 = window.btoa(binary);

  //       // Emit to server with the room ID
  //       socketRef.current?.emit("audio-chunk", {
  //         roomId: currentRoomId,
  //         audio: base64,
  //       });
  //     };

  //     source.connect(processor);
  //     processor.connect(audioCtx.destination);
  //     console.log("🎙️ Mic relay active...");
  //   } catch (err) {
  //     console.error("Error accessing microphone:", err);
  //   }
  // };

  // const playPCM = (base64: string) => {
  //   const ctx = audioCtxRef.current;
  //   if (!ctx) return;

  //   const binary = window.atob(base64);
  //   const bytes = new Uint8Array(binary.length);
  //   for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  //   const pcm16 = new Int16Array(bytes.buffer);
  //   const float32 = new Float32Array(pcm16.length);
  //   for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

  //   const buffer = ctx.createBuffer(1, float32.length, 24000);
  //   buffer.getChannelData(0).set(float32);

  //   const source = ctx.createBufferSource();
  //   source.buffer = buffer;
  //   source.connect(ctx.destination);
  //   source.start();
  // };

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
