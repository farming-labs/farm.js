// Client-safe: the form script imports this, so it holds no server code.

/** Messages for the codes the scan API returns, shared by the server page and the form script. */
export const AGENT_CHECK_ERRORS: Record<string, string> = {
  invalid_url: "That doesn't look like a website address.",
  address_blocked: "That address points at a private network. Only public sites can be checked.",
  dns_failed: "We couldn't find that domain. Check the spelling.",
  timeout: "The site took longer than 10 seconds to answer.",
  protocol_not_allowed: "Only http and https addresses can be checked.",
  port_not_allowed: "Only sites on the standard ports, 80 and 443, can be checked.",
  credentials_in_url: "Remove the username and password from the address.",
  response_too_large: "The page is larger than 2 MB.",
  too_many_redirects: "The page redirects too many times.",
  request_failed: "The site didn't accept the connection.",
  not_html: "That address doesn't serve a web page.",
  page_error: "The page answered with a server error.",
  host_busy: "That site was checked a lot in the last few minutes. Try again shortly.",
  rate_limited: "You've run a lot of checks. Try again in a few minutes.",
  body_too_large: "Send only the website address.",
  unavailable: "The agent-ready check is not available right now.",
};

export function agentCheckErrorMessage(code: string | undefined): string {
  return (code && AGENT_CHECK_ERRORS[code]) || "The check couldn't run. Try again in a moment.";
}
