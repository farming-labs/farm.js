import { createNoteEndpoint, listNotesEndpoint } from "../../../features/notes/server";

export const GET = listNotesEndpoint;
export const POST = createNoteEndpoint;
