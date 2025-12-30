"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

// Define the shape of our socket messages
interface OfferPayload {
  offer: RTCSessionDescriptionInit;
  roomId: string;
}

interface AnswerPayload {
  answer: RTCSessionDescriptionInit;
}

interface IceCandidatePayload {
  candidate: RTCIceCandidateInit;
  roomId: string;
}

// STUN servers
const iceServers: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function AudioCall() {
  const [roomId, setRoomId] = useState<string>("");
  const [isJoined, setIsJoined] = useState<boolean>(false);

  // 1. Properly typed Refs
  const socketRef = useRef<Socket | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Initialize Socket
    // REPLACE with your Ngrok Backend URL
    socketRef.current = io(
      process.env.NEXT_PUBLIC_BACKEND_URL ??
        "https://glycolic-coactive-janyce.ngrok-free.dev",
      {
        extraHeaders: {
          "ngrok-skip-browser-warning": "true",
        },
      }
    );

    const socket = socketRef.current;

    socket.on("user-joined", handleUserJoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);

    return () => {
      socket.off("user-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.disconnect();
    };
  }, [roomId]);

  const setupMedia = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Ensure you are on HTTPS.");
    }
  };

  const createPeerConnection = (): RTCPeerConnection => {
    const pc = new RTCPeerConnection(iceServers);

    // Add local tracks to the connection
    if (localStream.current) {
      localStream.current.getTracks().forEach((track: MediaStreamTrack) => {
        if (localStream.current) {
          pc.addTrack(track, localStream.current);
        }
      });
    }

    // Listen for remote tracks
    pc.ontrack = (event: RTCTrackEvent) => {
      const [remoteStream] = event.streams;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    };

    // Send ICE candidates to the other peer
    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("ice-candidate", {
          candidate: event.candidate,
          roomId,
        });
      }
    };

    peerConnection.current = pc;
    return pc;
  };

  const joinRoom = async (): Promise<void> => {
    if (!roomId) return alert("Enter room ID");
    await setupMedia();
    if (socketRef.current) {
      socketRef.current.emit("join-room", roomId);
      setIsJoined(true);
    }
  };

  const handleUserJoined = async (): Promise<void> => {
    const pc = createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("offer", { offer, roomId });
  };

  const handleOffer = async ({
    offer,
  }: {
    offer: RTCSessionDescriptionInit;
  }): Promise<void> => {
    const pc = createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit("answer", { answer, roomId });
  };

  const handleAnswer = async ({
    answer,
  }: {
    answer: RTCSessionDescriptionInit;
  }): Promise<void> => {
    if (peerConnection.current) {
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    }
  };

  const handleIceCandidate = async (
    candidate: RTCIceCandidateInit
  ): Promise<void> => {
    if (peerConnection.current) {
      try {
        await peerConnection.current.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (e) {
        console.error("Error adding ice candidate", e);
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900 text-white font-sans">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-700">
        <h1 className="text-3xl font-extrabold mb-6 text-center bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          WebRTC Audio
        </h1>

        {!isJoined ? (
          <div className="flex flex-col gap-4">
            <input
              className="p-3 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="Enter Room ID (e.g. 123)"
              value={roomId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setRoomId(e.target.value)
              }
            />
            <button
              onClick={joinRoom}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-blue-900/20"
            >
              Start Call
            </button>
          </div>
        ) : (
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20"></div>
                <div className="relative bg-blue-600 p-8 rounded-full text-4xl shadow-inner">
                  🎙️
                </div>
              </div>
            </div>
            <div>
              <p className="text-slate-400 text-sm uppercase tracking-widest mb-1">
                Status
              </p>
              <p className="text-xl font-medium text-emerald-400">
                Live in Room: {roomId}
              </p>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="text-slate-400 hover:text-red-400 text-sm underline transition-colors"
            >
              End Connection
            </button>

            {/* Hidden audio element to play the remote stream */}
            <audio ref={remoteAudioRef} autoPlay />
          </div>
        )}
      </div>
    </div>
  );
}
