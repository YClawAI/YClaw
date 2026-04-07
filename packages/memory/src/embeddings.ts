/**
 * Memory Architecture — Embedding Service
 * Thin wrapper around OpenAI embeddings.
 * Defaults to text-embedding-3-small unless the caller overrides the model.
 * Shared across Dedup (Phase 2) and Episode Search (Phase 3).
 */

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

interface EmbeddingConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;

export class OpenAIEmbeddingService implements EmbeddingService {
  private apiKey: string;
  private model: string;
  private dimensions: number;

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.dimensions = config.dimensions || DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // OpenAI supports up to 2048 inputs per batch
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += 2048) {
      batches.push(texts.slice(i, i + 2048));
    }

    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: batch,
          model: this.model,
          dimensions: this.dimensions,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding API error (${response.status}): ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        usage: { prompt_tokens: number; total_tokens: number };
      };

      // Sort by index to maintain order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sorted.map(d => d.embedding));
    }

    return allEmbeddings;
  }
}

/**
 * Null embedding service for when OPENAI_API_KEY is not configured.
 * Returns zero vectors — dedup will never match, which is safe (no false merges).
 */
export class NullEmbeddingService implements EmbeddingService {
  private dimensions: number;

  constructor(dimensions = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0));
  }
}
