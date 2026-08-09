export interface InviteContributor {
  /** Supabase invites.id — present once the invite has been synced to the database. */
  id?: string;
  name: string;
  contact: string;
  method: 'WhatsApp' | 'Email' | 'SMS';
  sent: boolean;
  responded: boolean;
  viewed?: boolean;
  allowedUpload?: boolean;
  isMuted?: boolean;
}

export interface CelebrativeEvent {
  id: string;
  title: string;
  occ: string;
  cel: string;
  date: string;
  emoji: string;
  status: 'active' | 'delivered' | 'pending';
  invites: InviteContributor[];
  uploads: string[];
  link: string;
  pipeline: number;
  created: number;
}

export interface BirthdayContact {
  id: string;
  name: string;
  rel: string;
  date: string;
  phone: string;
  emoji: string;
}

export interface ActivityFeedItem {
  id: string;
  type: 'done' | 'pending' | 'alert';
  icon: string;
  text: string;
  time: string;
  stage: string;
}

export interface WishComment {
  id: string;
  author: string;
  text: string;
  created: number;
}

export interface MediaItem {
  id: string;
  type: 'video' | 'audio' | 'text' | 'photo';
  name: string;
  from: string;
  note: string;
  event: string;
  size: string;
  dur: number;
  url: string | null;
  thumb: string | null;
  textBody?: string;
  file?: File | null;
  style?: string;
  created: number;
  /** Organizer approval gate. Undefined/true = visible (back-compat with existing data); false = pending review, excluded from the studio timeline and delivery gallery until approved. */
  approved?: boolean;
  comments?: WishComment[];
}

export interface TextOverlay {
  id: string;
  text: string;
  pos: 'centre' | 'bottom' | 'top';
  color: string;
  size: number;
  clipId?: string;
  fontFamily?: string;
  startTime?: number;
  endTime?: number;
  styleBold?: boolean;
  styleItalic?: boolean;
  x?: number;
  y?: number;
  backplate?: 'none' | 'shadow' | 'strip';
}

export interface SurpriseTheme {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  colors: {
    orange: string;
    c1: string;
    c2: string;
    ink: string;
  };
}

export interface PlanTier {
  id: string;
  l: string;
  i: string;
  p: string;
  c: string;
  bg: string;
  badge: string;
  msgAllowance: number;
  videoUploads: number;
  signUpPoints: number;
  referralPoints: number;
  studio: string;
  personalization: string;
  celebrations: string | string[];
  deliverySpeed: string;
  support: string;
  ai: boolean;
  mixer: boolean;
  premiumEffects: boolean;
  price: number;
}

export interface UserProfile {
  /** Supabase auth.users id — required for real, cross-device campaigns. Absent only for legacy/demo local-only accounts. */
  id?: string;
  name: string;
  em: string;
  pw: string;
  tier: string;
  phone: string;
  city: string;
  points: number;
  monthlyMsgCount: number;
  isDemo?: boolean;
  /** White-label branding, applied to intro/outro cards and the delivery reveal page. */
  brandLogoDataUrl?: string;
  brandColor?: string;
}
