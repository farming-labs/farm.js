import React from "react";
import type { PageProps } from "@farm.js/core";

// Route segments may contain dots (e.g. /repos/kinfish/farm.js). This page
// exists so e2e coverage can assert dotted segments reach the router instead
// of being treated as static assets.
export default function RepoPage({ params = {} }: PageProps) {
  const { owner = "", repo = "" } = params;

  return (
    <div style={{ padding: "2rem" }}>
      <h1 data-testid="repo-title">
        {owner}/{repo}
      </h1>
      <p data-testid="repo-owner">Owner: {owner}</p>
      <p data-testid="repo-name">Repository: {repo}</p>
    </div>
  );
}
