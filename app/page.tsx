"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function AudioCall() {
  const [roomId, setRoomId] = useState<string>("");
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [targetLang, setTargetLang] = useState<string>("Spanish");
  const [isTranslationEnabled, setIsTranslationEnabled] =
    useState<boolean>(false);

  const socketRef = useRef<Socket | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    socketRef.current = io(
      process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000",
      {
        extraHeaders: { "ngrok-skip-browser-warning": "true" },
      }
    );

    const socket = socketRef.current;
    socket.on("user-joined", handleUserJoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);

    // Listen for translated audio from the other person
    socket.on("translated-audio-chunk", (base64Audio: string) => {
      playTranslatedChunk(base64Audio);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  // --- TRANSLATION LOGIC ---
  const startAudioStreaming = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Note: OpenAI Realtime prefers 24kHz Mono PCM, but for simplicity we use webm
    const mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && isTranslationEnabled) {
        const reader = new FileReader();
        reader.readAsDataURL(event.data);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(",")[1];
          socketRef.current?.emit("audio-chunk", {
            audio: base64data,
            targetLanguage: targetLang,
          });
        };
      }
    };
    mediaRecorder.start(500); // Send every 500ms
    mediaRecorderRef.current = mediaRecorder;
  };

  const playTranslatedChunk = (base64: string) => {
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    const blob = new Blob([array], { type: "audio/pcm" }); // Simplified
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  };

  // --- EXISTING WEBRTC LOGIC ---
  const setupMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.current = stream;
    if (isTranslationEnabled) startAudioStreaming();
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    localStream.current
      ?.getTracks()
      .forEach((t) => pc.addTrack(t, localStream.current!));

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        // If translating, we MUTE the direct P2P audio so we only hear the AI
        remoteAudioRef.current.muted = isTranslationEnabled;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate)
        socketRef.current?.emit("ice-candidate", {
          candidate: e.candidate,
          roomId,
        });
    };
    peerConnection.current = pc;
    return pc;
  };

  const joinRoom = async () => {
    if (!roomId) return;
    await setupMedia();
    socketRef.current?.emit("join-room", roomId);
    setIsJoined(true);
  };

  const handleUserJoined = async () => {
    const pc = createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("offer", { offer, roomId });
  };

  const handleOffer = async ({ offer }: any) => {
    const pc = createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit("answer", { answer, roomId });
  };

  const handleAnswer = async ({ answer }: any) => {
    await peerConnection.current?.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  };

  const handleIceCandidate = async (candidate: any) => {
    await peerConnection.current?.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-6">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
        <h1 className="text-2xl font-bold mb-6 text-center text-blue-400">
          AI Audio Translator
        </h1>

        <div className="mb-6 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isTranslationEnabled}
              onChange={(e) => setIsTranslationEnabled(e.target.checked)}
              className="w-5 h-5"
            />
            <span>Enable Real-time Translation</span>
          </label>

          {isTranslationEnabled && (
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-full bg-slate-700 p-2 rounded border border-slate-600"
            >
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Urdu">Urdu</option>
            </select>
          )}
        </div>

        {!isJoined ? (
          <div className="flex flex-col gap-4">
            <input
              className="p-3 bg-slate-700 rounded border border-slate-600"
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button
              onClick={joinRoom}
              className="bg-blue-600 py-3 rounded-lg font-bold"
            >
              Start Call
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-emerald-400 animate-pulse mb-4">
              ● Live in Room {roomId}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="text-red-400 underline"
            >
              End Call
            </button>
            <audio ref={remoteAudioRef} autoPlay />
          </div>
        )}
      </div>
    </div>
  );
}
