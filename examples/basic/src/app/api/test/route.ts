import { createEndpoint } from "@farm.js/core"
import { z } from "zod"

export const GET = createEndpoint('/api/test', {
    method: 'GET',
    query: z.object({
        name: z.string().optional(),
    })
}, async (ctx) => {
    return {
        message: 'Hello World',
    }
})