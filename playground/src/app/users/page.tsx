import React from "react";
import type { PageProps } from "@farmjs/core";

export default function UsersPage({ params, searchParams }: PageProps) {
  const users = [
    { id: 1, name: "Alice Johnson", email: "alice@example.com" },
    { id: 2, name: "Bob Smith", email: "bob@example.com" },
    { id: 3, name: "Charlie Brown", email: "charlie@example.com" },
    { id: 123, name: "Test User", email: "test@example.com" },
  ];

  return (
    <div>
      <h1 style={{ color: "#1e293b", marginBottom: "1rem" }}>Users</h1>

      <p style={{ color: "#64748b", marginBottom: "2rem" }}>
        This page demonstrates static data rendering. Click on a user to see dynamic routing.
      </p>

      <div
        style={{
          background: "white",
          borderRadius: "0.5rem",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {users.map((user, index) => (
          <div
            key={user.id}
            style={{
              padding: "1rem 1.5rem",
              borderBottom: index < users.length - 1 ? "1px solid #e2e8f0" : "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h3 style={{ margin: "0 0 0.25rem 0", color: "#1e293b" }}>{user.name}</h3>
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.875rem" }}>{user.email}</p>
            </div>
            <a
              href={`/users/${user.id}`}
              style={{
                padding: "0.5rem 1rem",
                background: "#3b82f6",
                color: "white",
                textDecoration: "none",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              View Profile
            </a>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "2rem",
          padding: "1rem",
          background: "#fefce8",
          borderRadius: "0.375rem",
          border: "1px solid #fde047",
        }}
      >
        <p style={{ margin: 0, color: "#713f12" }}>
          <strong>Routing Test:</strong> Try navigating to <code>/users/123</code> to see dynamic
          routing in action!
        </p>
      </div>
    </div>
  );
}
