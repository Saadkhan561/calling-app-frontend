"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function AudioCall() {
  const [roomId, setRoomId] = useState<string>("");
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [isTranslationEnabled, setIsTranslationEnabled] =
    useState<boolean>(false);

  const socketRef = useRef<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    socketRef.current = io(
      process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000",
      { extraHeaders: { "ngrok-skip-browser-warning": "true" } }
    );

    socketRef.current.on("translated-audio-chunk", (base64Audio: string) => {
      console.log("🔊 Received Translation Chunk from Server");
      playPCM(base64Audio);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const bufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // --- CAPTURE RAW PCM AUDIO ---
  const startAudioProcessor = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create AudioContext specifically at 24000Hz as OpenAI requires
    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    // 4096 buffer size is standard
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!isTranslationEnabled) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // 1. Convert Float32 to Int16 PCM
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        // Clamp values between -1 and 1 and convert to 16-bit range
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // 2. Convert Int16Array Buffer to Base64 safely
      const base64 = bufferToBase64(pcm16.buffer);

      console.log("🎤 Audio captured, sending to backend...");
      socketRef.current?.emit("audio-chunk", { audio: base64 });
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  };

  const convertFloat32ToInt16 = (buffer: Float32Array) => {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, buffer[l]) * 0x7fff; // Convert -1..1 to -32768..32767
    }
    return buf;
  };

  // --- PLAYBACK RAW PCM AUDIO ---
  const playPCM = (base64: string) => {
    if (!audioCtxRef.current) return;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

    const buffer = audioCtxRef.current.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtxRef.current.destination);
    source.start();
  };

  const joinCall = async () => {
    if (!roomId) return;
    await startAudioProcessor();
    socketRef.current?.emit("join-room", roomId);
    setIsJoined(true);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white">
      <div className="bg-slate-800 p-8 rounded-xl shadow-2xl border border-slate-700 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center text-emerald-400">
          Live AI Translator
        </h1>

        <div className="flex items-center gap-3 mb-6 bg-slate-700 p-4 rounded-lg">
          <input
            type="checkbox"
            checked={isTranslationEnabled}
            onChange={(e) => setIsTranslationEnabled(e.target.checked)}
            className="w-5 h-5 accent-emerald-500"
          />
          <span>Enable Live Translation</span>
        </div>

        {!isJoined ? (
          <div className="flex flex-col gap-4">
            <input
              className="p-3 bg-slate-600 rounded border border-slate-500"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button
              onClick={joinCall}
              className="bg-blue-600 py-3 rounded-lg font-bold hover:bg-blue-500 transition"
            >
              Start Call
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="mb-4 text-emerald-400">Connected to {roomId}</div>
            <p className="text-sm text-slate-400 mb-4">
              Open your browser console to see logs!
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-red-400 underline"
            >
              End Call
            </button>
          </div>
        )}
      </div>
      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />
    </div>
  );
}
