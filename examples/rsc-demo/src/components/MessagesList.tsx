"use client";

import React, { useState, useEffect, useCallback } from "react";
import { getMessages } from "../actions/user";

type Message = {
  id: number;
  name: string;
  message: string;
  timestamp: string;
};

export function MessagesList() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getMessages();
      setMessages(data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch messages on mount
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Listen for custom event to refresh messages
  useEffect(() => {
    const handleRefresh = () => {
      fetchMessages();
    };
    window.addEventListener("messages-updated", handleRefresh);
    return () => window.removeEventListener("messages-updated", handleRefresh);
  }, [fetchMessages]);

  return (
    <div className="bg-slate-800/50 rounded-xl p-6 border border-emerald-700/50">
      <h3 className="text-xl font-semibold text-emerald-400 mb-4">
        Messages (Live Updates)
      </h3>
      <p className="text-slate-400 mb-4">
        Messages are fetched from the server. New messages appear automatically!
      </p>

      {isLoading ? (
        <div className="text-center py-8 text-slate-500">
          Loading messages...
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          No messages yet. Submit one using the form!
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="bg-slate-900/50 rounded-lg p-4 border border-slate-700"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-semibold text-white">{msg.name}</span>
                <span className="text-xs text-slate-500">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-slate-300">{msg.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
