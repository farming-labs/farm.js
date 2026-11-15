"use server";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function* countdown() {
  for (const count of [3, 2, 1]) {
    await wait(50);
    yield String(count);
  }
}

// Returns before its stream and promise finish, as an RSC action can.
export async function launch() {
  return { countdown: countdown(), status: wait(200).then(() => "launched") };
}
