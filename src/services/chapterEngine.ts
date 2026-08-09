/**
 * Smart Story Engine - reorders the timeline into a chapter structure (Opening, Childhood,
 * Family, Friends, School, College, Office, Funny Moments, Travel, Cake Cutting, Ending, etc.)
 * instead of leaving clips in plain upload order.
 *
 * IMPORTANT - what this actually is: this is a keyword/metadata HEURISTIC, not real scene
 * understanding. It reads each clip's name/note/contributor fields, matches them against a
 * list of chapter keywords, and groups+reorders on that basis. Clips with no recognizable
 * keyword fall back to their original upload-order position within an "Other Memories"
 * chapter. This is deliberately not oversold as AI video comprehension - a browser-only,
 * self-hosted app has no reliable way to actually understand video content by itself.
 */

export interface Chapter {
  id: string;
  title: string;
  emoji: string;
  keywords: string[];
}

// Order here IS the resulting timeline order.
export const STORY_CHAPTERS: Chapter[] = [
  { id: 'opening', title: 'With Love', emoji: '💌', keywords: ['opening', 'intro', 'welcome', 'title'] },
  { id: 'childhood', title: 'Childhood Memories', emoji: '🧸', keywords: ['childhood', 'baby', 'kid', 'young', 'little'] },
  { id: 'parents', title: 'From Mom & Dad', emoji: '👨‍👩‍👧', keywords: ['mom', 'mother', 'dad', 'father', 'parent'] },
  { id: 'family', title: 'Family', emoji: '👪', keywords: ['family', 'grandma', 'grandpa', 'sister', 'brother', 'cousin', 'aunt', 'uncle'] },
  { id: 'friends', title: 'Best Friends', emoji: '🤝', keywords: ['friend', 'bestie', 'buddy', 'squad'] },
  { id: 'school', title: 'School Memories', emoji: '🎒', keywords: ['school', 'classmate', 'teacher'] },
  { id: 'college', title: 'College Days', emoji: '🎓', keywords: ['college', 'university', 'campus', 'roommate'] },
  { id: 'office', title: 'Office Family', emoji: '💼', keywords: ['office', 'work', 'colleague', 'coworker', 'team', 'boss'] },
  { id: 'funny', title: 'Funny Moments', emoji: '😂', keywords: ['funny', 'lol', 'joke', 'laugh', 'silly', 'prank'] },
  { id: 'travel', title: 'Travel Memories', emoji: '✈️', keywords: ['travel', 'trip', 'vacation', 'holiday', 'beach', 'road trip'] },
  { id: 'messages', title: 'Group Messages', emoji: '💬', keywords: ['message', 'wish', 'group', 'shoutout'] },
  { id: 'cake', title: 'Cake Cutting', emoji: '🎂', keywords: ['cake', 'candle', 'blow', 'party'] },
  { id: 'ending', title: 'Happy Birthday', emoji: '🎉', keywords: ['ending', 'outro', 'closing', 'goodbye', 'final'] },
];

const OTHER_CHAPTER: Chapter = { id: 'other', title: 'More Memories', emoji: '✨', keywords: [] };

function textOf(clip: any): string {
  return [clip.name, clip.note, clip.contributorName, clip.caption]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchChapter(clip: any): Chapter | null {
  const text = textOf(clip);
  if (!text) return null;
  for (const chapter of STORY_CHAPTERS) {
    if (chapter.keywords.some((kw) => text.includes(kw))) return chapter;
  }
  return null;
}

export interface ArrangedResult {
  /** Clips in their new chapter order, with auto-generated chapter title cards spliced in
   *  wherever a chapter has at least one matched clip. */
  clips: any[];
  /** Which chapters actually matched at least one clip, in final order - useful for showing
   *  the user what the engine decided. */
  matchedChapters: { chapter: Chapter; clipCount: number }[];
}

/**
 * Groups clips into chapters by keyword match (falling back to original upload order within
 * an "Other" bucket placed just before the ending), then returns a new clip list with an
 * auto-generated animated title card ('text' clip) inserted at the start of every chapter that
 * has at least one real clip in it.
 */
export function arrangeIntoChapters(clips: any[]): ArrangedResult {
  const buckets = new Map<string, any[]>();
  for (const chapter of [...STORY_CHAPTERS, OTHER_CHAPTER]) buckets.set(chapter.id, []);

  for (const clip of clips) {
    const matched = matchChapter(clip);
    buckets.get(matched ? matched.id : OTHER_CHAPTER.id)!.push(clip);
  }

  // "Other" (unmatched) clips slot in right before the closing/ending chapter, so nothing
  // detected as an explicit "ending" clip still gets pushed later than intended.
  const orderedChapterIds = [
    ...STORY_CHAPTERS.filter((c) => c.id !== 'ending').map((c) => c.id),
    OTHER_CHAPTER.id,
    'ending',
  ];

  const result: any[] = [];
  const matchedChapters: { chapter: Chapter; clipCount: number }[] = [];
  const allChapters = [...STORY_CHAPTERS, OTHER_CHAPTER];

  for (const chapterId of orderedChapterIds) {
    const bucketClips = buckets.get(chapterId) || [];
    if (bucketClips.length === 0) continue;
    const chapter = allChapters.find((c) => c.id === chapterId)!;
    matchedChapters.push({ chapter, clipCount: bucketClips.length });

    result.push({
      id: `chapter_${chapterId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'text',
      name: `${chapter.emoji} ${chapter.title}`,
      textBody: `${chapter.emoji}  ${chapter.title}`,
      trimStart: 0,
      trimEnd: 2.5,
      transition: 'auto',
      isChapterTitle: true,
    });
    result.push(...bucketClips);
  }

  return { clips: result, matchedChapters };
}

/**
 * Builds a single auto-generated "cinematic ending" title card clip: a closing birthday
 * message with a fade-to-black finish. This is a real, working 'text' clip using the existing
 * wish-card render path (drawtext on a solid background) - it doesn't attempt to fake true
 * particle/confetti compositing (there's no such effect in the render pipeline), just an
 * honest, well-composed closing card with a smooth fade out.
 */
export function buildCinematicEndingClip(customMessage?: string): any {
  const message =
    customMessage ||
    '🎉 May all your dreams come true 🎉\n\nHappy Birthday!\n\nWith Love,\nFriends & Family 💕';
  return {
    id: `ending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    name: '🎆 Cinematic Ending',
    textBody: message,
    trimStart: 0,
    trimEnd: 5,
    transition: 'fade',
    transitionDuration: 1,
    fadeOut: 1.5,
    isEndingCard: true,
  };
}

