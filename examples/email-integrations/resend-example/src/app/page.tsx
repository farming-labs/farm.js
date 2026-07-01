import { HomeClient } from "./home-client";

export default function Page() {
  return <HomeClient webhookPath="/api/email/webhook" />;
}
