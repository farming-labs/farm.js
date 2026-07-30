import { createEndpoint, jsonStream, multipart } from '@farm.js/core/api';
import { z } from 'zod';

const uploadBody = multipart(
  z.object({
    title: z.string().min(1),
    file: z.custom<Blob>((value) => value instanceof Blob),
    tags: z
      .union([z.string(), z.array(z.string())])
      .transform((value) => (Array.isArray(value) ? value : [value])),
  }),
);

type ImportEvent =
  | {
      phase: 'accepted';
      title: string;
      bytes: number;
    }
  | {
      phase: 'complete';
      tags: string[];
    };

export const POST = createEndpoint(
  {
    method: 'POST',
    body: uploadBody,
  },
  async ({ body }) => {
    return jsonStream<ImportEvent>([
      {
        phase: 'accepted',
        title: body.title,
        bytes: body.file.size,
      },
      {
        phase: 'complete',
        tags: body.tags,
      },
    ]);
  },
);
