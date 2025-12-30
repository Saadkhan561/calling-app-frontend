"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function AudioCall() {
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    socketRef.current = io("http://localhost:5000"); // Update with your URL

    socketRef.current.on("translated-audio-chunk", (base64Audio: string) => {
      console.log("🔊 Playback: Received audio chunk from AI");
      playPCM(base64Audio);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const startAudio = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 1. Initialize Audio Context at 24kHz
    const audioCtx = new (window.AudioContext ||
      (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;

    // 2. Resume context (Browser requirement)
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);

      // Convert Float32 to Int16 PCM
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Safe Base64 encoding
      const binary = String.fromCharCode(...new Uint8Array(pcm16.buffer));
      const base64 = window.btoa(binary);

      socketRef.current?.emit("audio-chunk", { audio: base64 });
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    console.log("🎙️ Mic active and streaming PCM...");
  };

  const playPCM = (base64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white">
      <div className="p-8 bg-slate-800 rounded-xl border border-slate-700 w-80 text-center">
        <h1 className="text-xl font-bold mb-4">English Translator</h1>
        {!isJoined ? (
          <>
            <input
              className="w-full p-2 mb-4 bg-slate-700 rounded"
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button
              onClick={() => {
                startAudio();
                setIsJoined(true);
                socketRef.current?.emit("join-room", roomId);
              }}
              className="w-full bg-blue-600 py-2 rounded font-bold"
            >
              Join & Translate
            </button>
          </>
        ) : (
          <div className="text-emerald-400">● Live in Room {roomId}</div>
        )}
      </div>
    </div>
  );
}
