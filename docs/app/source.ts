import { loader } from 'fumadocs-core/source'
import { createMDXSource } from 'fumadocs-mdx'
import { icons } from 'lucide-react'

export const source = loader({
  baseUrl: '/docs',
  source: createMDXSource([], {
    schema: {
      frontmatter: {
        title: {
          type: 'string',
          required: true,
        },
        description: {
          type: 'string',
        },
        icon: {
          type: 'string',
        },
      },
    },
  }),
})

export const pageTree = source.pageTree

