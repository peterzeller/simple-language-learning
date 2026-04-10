declare module "openai" {
  export interface ResponseCreateParams {
    model: string;
    input: Array<{ role: "system" | "user"; content: string }>;
    tools?: Array<{ type: string }>;
    text?: {
      format: {
        type: "json_schema";
        name: string;
        schema: Record<string, unknown>;
        strict: boolean;
      };
    };
  }

  export interface SpeechCreateParams {
    model: string;
    voice: string;
    instructions?: string;
    format: "mp3";
    input: string;
  }

  export default class OpenAI {
    constructor(options: { apiKey: string });
    responses: {
      create(params: ResponseCreateParams): Promise<{ output_text: string }>;
      stream(params: ResponseCreateParams): {
        on(event: "response.output_text.delta", listener: (event: { delta: string }) => void): void;
        done(): Promise<void>;
      };
    };
    audio: {
      speech: {
        create(params: SpeechCreateParams): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
      };
    };
  }
}
