import { supabase } from './supabaseClient';
import type { MediaItem, CelebrativeEvent, InviteContributor } from '../types';

/** Inserts a batch of contributors into the real invites table for a campaign. */
export async function createInvites(campaignId: string, invites: InviteContributor[]): Promise<InviteContributor[]> {
  if (invites.length === 0) return [];

  const { data, error } = await supabase
    .from('invites')
    .insert(
      invites.map(inv => ({
        campaign_id: campaignId,
        name: inv.name,
        contact: inv.contact,
        method: inv.method,
        sent: inv.sent ?? true,
        responded: inv.responded ?? false,
        allowed_upload: inv.allowedUpload ?? true,
        is_muted: inv.isMuted ?? false,
      }))
    )
    .select();

  if (error) throw new Error(`Could not save invite list: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    method: row.method,
    sent: row.sent,
    responded: row.responded,
    viewed: row.viewed,
    allowedUpload: row.allowed_upload,
    isMuted: row.is_muted,
  }));
}

/** Loads the real contributor list for one campaign. */
export async function fetchCampaignInvites(campaignId: string): Promise<InviteContributor[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    method: row.method,
    sent: row.sent,
    responded: row.responded,
    viewed: row.viewed,
    allowedUpload: row.allowed_upload,
    isMuted: row.is_muted,
  }));
}

/** Updates one invite row (e.g. marking responded, muting, changing upload permission). */
export async function updateInvite(inviteId: string, updates: Partial<{
  responded: boolean; viewed: boolean; sent: boolean; allowedUpload: boolean; isMuted: boolean;
}>) {
  const dbUpdates: Record<string, any> = {};
  if (updates.responded !== undefined) dbUpdates.responded = updates.responded;
  if (updates.viewed !== undefined) dbUpdates.viewed = updates.viewed;
  if (updates.sent !== undefined) dbUpdates.sent = updates.sent;
  if (updates.allowedUpload !== undefined) dbUpdates.allowed_upload = updates.allowedUpload;
  if (updates.isMuted !== undefined) dbUpdates.is_muted = updates.isMuted;

  const { error } = await supabase.from('invites').update(dbUpdates).eq('id', inviteId);
  if (error) throw error;
}

/**
 * Creates a real campaign row in Supabase, owned by the currently logged-in
 * organizer. Returns a CelebrativeEvent using the REAL database uuid as its
 * id — this is required: media_items.campaign_id is a uuid foreign key, so
 * any locally-generated fake id (e.g. "e_1699999999") is silently rejected
 * by the database, which is why contributor submissions never showed up.
 */
export async function createCampaign(params: {
  title: string;
  occasion: string;
  celebrant: string;
  date: string;
  emoji: string;
  invites?: InviteContributor[];
}): Promise<CelebrativeEvent> {
  const { data: userData } = await supabase.auth.getUser();
  const organizerId = userData.user?.id;
  if (!organizerId) throw new Error('You must be logged in to create a campaign.');

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      organizer_id: organizerId,
      title: params.title,
      occasion: params.occasion,
      celebrant: params.celebrant,
      event_date: params.date || null,
      emoji: params.emoji,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(`Could not create campaign: ${error.message}`);

  // Save the contributor list as real rows too, not just local state —
  // this is what makes the Dashboard's invite/response tracking real.
  let savedInvites: InviteContributor[] = [];
  if (params.invites && params.invites.length > 0) {
    savedInvites = await createInvites(data.id, params.invites);
  }

  return {
    id: data.id, // real uuid — this is the fix
    title: data.title,
    occ: data.occasion,
    cel: data.celebrant,
    date: data.event_date,
    emoji: data.emoji,
    status: data.status,
    invites: savedInvites,
    uploads: [],
    link: `${window.location.origin}/?portal=${data.invite_slug}`,
    pipeline: savedInvites.length > 0 ? 1 : 0,
    created: new Date(data.created_at).getTime(),
  };
}

/** Loads every campaign owned by the currently logged-in organizer, including each campaign's real invite list. */
export async function fetchMyCampaigns(): Promise<CelebrativeEvent[]> {
  const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
  if (error) throw error;

  const campaigns = data || [];

  // Fetch every campaign's invites in parallel rather than one-by-one.
  const invitesByCapaign = await Promise.all(
    campaigns.map((row: any) => fetchCampaignInvites(row.id).catch(() => []))
  );

  return campaigns.map((row: any, i: number) => ({
    id: row.id,
    title: row.title,
    occ: row.occasion,
    cel: row.celebrant,
    date: row.event_date,
    emoji: row.emoji,
    status: row.status,
    invites: invitesByCapaign[i],
    uploads: [],
    link: `${window.location.origin}/?portal=${row.invite_slug}`,
    pipeline: invitesByCapaign[i].length > 0 ? 1 : 0,
    created: new Date(row.created_at).getTime(),
  }));
}

/**
 * Replaces App.tsx's handlePortalWishSubmission, which currently only does
 * `setMedia(prev => [...prev, item])` — local state, invisible to the organizer.
 *
 * This version:
 *  1. Uploads the real file/blob to Supabase Storage (bucket "media"),
 *     namespaced under the campaign id so storage RLS can scope access.
 *  2. Inserts a row describing the contribution, which the organizer's
 *     dashboard is subscribed to in real time (see subscribeToCampaignMedia).
 *
 * Called from the Contributor Portal. Runs as the Supabase `anon` role —
 * allowed by the "media_anon_insert_active_campaign" RLS policy, and nothing else.
 */
export async function submitContribution(params: {
  campaignId: string;
  type: 'video' | 'audio' | 'text' | 'photo';
  fromName: string;
  note?: string;
  textBody?: string;
  file?: File | Blob | null;   // the REAL captured/uploaded media
  durationSeconds?: number;
}) {
  const { campaignId, type, fromName, note, textBody, file, durationSeconds } = params;

  let storagePath: string | null = null;

  if (file) {
    const ext = file instanceof File ? file.name.split('.').pop() : (type === 'photo' ? 'jpg' : type === 'audio' ? 'webm' : 'mp4');
    storagePath = `${campaignId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, file, { contentType: file.type || undefined });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data, error } = await supabase
    .from('media_items')
    .insert({
      campaign_id: campaignId,
      type,
      from_name: fromName,
      note: note ?? null,
      text_body: textBody ?? null,
      storage_path: storagePath,
      duration: durationSeconds ?? null,
      size_bytes: file ? (file as any).size ?? null : null,
      approved: false,
    })
    .select()
    .single();

  if (error) throw new Error(`Submission failed: ${error.message}`);
  return data;
}

/**
 * Organizer dashboard: fetch current media for a campaign (initial load),
 * with each item's real, viewable signed URL already resolved — never null.
 * This is required: leaving storage items unresolved (url: null) is exactly
 * what caused Video/Slideshow Studio to try drawing a broken/missing image
 * onto canvas and crash with "HTMLImageElement is in the broken state".
 */
export async function fetchCampaignMedia(campaignId: string) {
  const { data, error } = await supabase
    .from('media_items')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return hydrateMediaUrls(data || []);
}

/** Resolves storage_path → a real signed URL for a batch of media rows, in parallel. */
export async function hydrateMediaUrls(rows: any[]): Promise<any[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.storage_path) return { ...row, resolved_url: null }; // text wishes have no file
      try {
        const url = await getMediaSignedUrl(row.storage_path);
        return { ...row, resolved_url: url };
      } catch (e) {
        console.warn(`Could not resolve signed URL for media_item ${row.id}:`, e);
        return { ...row, resolved_url: null }; // caller must handle this gracefully, never assume a valid image
      }
    })
  );
}

/**
 * Organizer dashboard: live-subscribe to new submissions for a campaign.
 * Replaces the fake "Just now" toast that only fired within the same tab —
 * this fires for real, from any contributor, on any device, in real time.
 * The callback receives the row with resolved_url already filled in, for the
 * same reason as fetchCampaignMedia above.
 *
 * Usage in App.tsx:
 *   useEffect(() => {
 *     const unsubscribe = subscribeToCampaignMedia(campaignId, (newItem) => {
 *       setMedia(prev => [newItem, ...prev]);
 *       showToast(`${newItem.from_name} submitted a new ${newItem.type} wish!`, 'success');
 *     });
 *     return unsubscribe;
 *   }, [campaignId]);
 */
export function subscribeToCampaignMedia(campaignId: string, onInsert: (item: any) => void) {
  const channel = supabase
    .channel(`media_items:${campaignId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'media_items', filter: `campaign_id=eq.${campaignId}` },
      async (payload) => {
        const [hydrated] = await hydrateMediaUrls([payload.new]);
        onInsert(hydrated);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

/** Organizer approves a submission before it can appear in Studio/Delivery. */
export async function approveMedia(mediaId: string, approved: boolean) {
  const { error } = await supabase.from('media_items').update({ approved }).eq('id', mediaId);
  if (error) throw error;
}

/** Gets a temporary signed URL for the organizer to view/download a private media file. */
export async function getMediaSignedUrl(storagePath: string, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from('media').createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

/** After a client-side ffmpeg render finishes, upload the final video so the delivery page can serve it from anywhere. */
export async function uploadRender(campaignId: string, blob: Blob, format: string) {
  const path = `${campaignId}/${crypto.randomUUID()}.${format}`;
  const { error: uploadError } = await supabase.storage.from('renders').upload(path, blob, { contentType: blob.type });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from('renders').insert({ campaign_id: campaignId, storage_path: path, format });
  if (insertError) throw insertError;

  const { data } = supabase.storage.from('renders').getPublicUrl(path);
  return data.publicUrl;
}
