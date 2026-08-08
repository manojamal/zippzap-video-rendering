import { pipeline } from '@huggingface/transformers';

// Lazily-loaded singleton text-generation pipeline. Runs fully in the browser via
// ONNX Runtime Web (WASM, with automatic WebGPU acceleration where available) - no
// server, no API key. Same pattern as speechToTextService.ts's Whisper pipeline.
//
// MODEL_ID starts as the base SmolLM2-360M-Instruct model. Once you've fine-tuned it
// on ZippZap's own data (see /zippzap-finetune) and pushed the exported ONNX model to
// the Hugging Face Hub, swap this to your own repo id (e.g. "your-username/zippzap-assistant")
// to get campaign-specific phrasing instead of the generic base model's output.
const MODEL_ID = 'HuggingFaceTB/SmolLM2-360M-Instruct';

let generatorPromise: Promise<any> | null = null;

export async function getGenerator(onProgress?: (pct: number, status: string) => void): Promise<any> {
  if (!generatorPromise) {
    generatorPromise = pipeline('text-generation', MODEL_ID, {
      progress_callback: (data: any) => {
        if (onProgress && data?.status === 'progress' && typeof data.progress === 'number') {
          onProgress(Math.round(data.progress), `Downloading AI writing model${data.file ? ` (${data.file})` : ''}...`);
        } else if (onProgress && data?.status === 'ready') {
          onProgress(100, 'AI writing model ready.');
        }
      },
    } as any).catch((err: any) => {
      generatorPromise = null; // allow retry
      throw err;
    });
  }
  return generatorPromise;
}

const SYSTEM_PROMPT =
  'You are a helpful assistant for ZippZap, a collaborative celebration video platform. ' +
  'You write short, warm, occasion-appropriate messages for campaign organizers and contributors. ' +
  'Keep responses concise and in the same style as the examples you were trained on. Do not add explanations, only output the message itself.';

async function generate(userPrompt: string, maxNewTokens: number, onProgress?: (pct: number, status: string) => void): Promise<string> {
  const generator = await getGenerator(onProgress);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
  const output: any = await generator(messages, {
    max_new_tokens: maxNewTokens,
    temperature: 0.7,
    do_sample: true,
  });
  const generated = output?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    return String(generated.at(-1)?.content ?? '').trim();
  }
  return String(generated ?? '').trim();
}

/**
 * Generates a dynamic nudge/reminder message from the campaign organizer to a
 * still-silent contributor, in a chosen tone. Replaces Dashboard.tsx's fixed
 * three-string template picker with per-campaign, occasion-aware phrasing.
 */
export async function generateNudgeMessage(
  celebrantName: string,
  occasion: string,
  tone: 'Friendly' | 'Party Beat' | 'Countdown',
  portalLink: string,
  onProgress?: (pct: number, status: string) => void
): Promise<string> {
  const toneDesc: Record<string, string> = {
    Friendly: 'warm, casual, encouraging',
    'Party Beat': 'upbeat, excited, fun with emoji energy',
    Countdown: 'urgent but still warm, conveys a closing deadline',
  };
  const prompt =
    `Write a short ${tone.toLowerCase()} tone nudge message reminding a contributor to submit ` +
    `their video or audio wish for ${celebrantName}'s ${occasion} surprise campaign. ` +
    `Tone should be ${toneDesc[tone]}. Include a call to action to click the portal link.`;
  const text = await generate(prompt, 100, onProgress);
  return text.replace(/\[PORTAL_LINK\]/gi, portalLink);
}

/**
 * Generates a personalized video/audio wish message for a contributor to send to
 * the celebrant. Replaces ContributorPortal.tsx's random pick from a fixed array
 * of 6 templates with a message tailored to the sender's name and chosen style.
 */
export async function generateContributorWish(
  celebrantName: string,
  occasion: string,
  style: 'Heartfelt' | 'Milestone' | 'Playful & Fun' | 'Short & Sweet',
  senderName?: string,
  onProgress?: (pct: number, status: string) => void
): Promise<string> {
  const styleDesc: Record<string, string> = {
    Heartfelt: 'sincere, emotional, celebrates who they are',
    Milestone: 'proud, celebrates an achievement or new chapter',
    'Playful & Fun': 'light teasing, funny, still affectionate',
    'Short & Sweet': 'brief, warm, under 3 sentences',
  };
  const from = senderName ? ` from ${senderName}` : '';
  const prompt =
    `Write a ${style.toLowerCase()} style video-message wish${from} to ${celebrantName} for their ` +
    `${occasion} celebration. Style should be ${styleDesc[style]}.`;
  return generate(prompt, 120, onProgress);
}

/**
 * Suggests 3 alternative campaign titles beyond CreateCampaign.tsx's default
 * `${celName}'s Surprise ${occasion}` auto-fill.
 */
export async function suggestCampaignTitles(
  celebrantName: string,
  occasion: string,
  onProgress?: (pct: number, status: string) => void
): Promise<string[]> {
  const prompt =
    `Suggest 3 creative campaign titles (not just "${celebrantName}'s Surprise ${occasion}") ` +
    `for a ${occasion} video-tribute campaign for ${celebrantName}.`;
  const text = await generate(prompt, 100, onProgress);
  return text
    .split('\n')
    .map((line) => line.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Classifies a wish's tone into a narrative section so a compiled video can group
 * clips (funny memories / heartfelt messages / milestone wishes) instead of a flat
 * chronological dump. Falls back to 'General' on any parsing failure - a
 * mis-classified clip just lands in the general section, never breaks compilation.
 */
export async function classifyWishTone(
  text: string,
  onProgress?: (pct: number, status: string) => void
): Promise<'Heartfelt' | 'Funny' | 'Milestone' | 'General'> {
  if (!text || !text.trim()) return 'General';
  const prompt =
    `Classify the tone of this celebration video wish message into exactly one word - ` +
    `Heartfelt, Funny, Milestone, or General. Reply with only that one word.\n\nMessage: "${text.slice(0, 400)}"`;
  try {
    const result = await generate(prompt, 6, onProgress);
    const cleaned = result.trim().split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, '');
    if (cleaned === 'Heartfelt' || cleaned === 'Funny' || cleaned === 'Milestone' || cleaned === 'General') {
      return cleaned;
    }
    return 'General';
  } catch {
    return 'General';
  }
}
