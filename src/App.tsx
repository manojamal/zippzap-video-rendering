import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CelebrativeEvent,
  BirthdayContact,
  ActivityFeedItem,
  MediaItem,
  UserProfile
} from './types';
import { seedData, DEMO_ACCOUNTS, TIERS, applyThemeStyle, validateUploadFileSize, MAX_UPLOAD_FILE_SIZE_MB, checkTimelineClipCountBudget, validateFileSignature, extractMediaFilesFromZip } from './utils';
import logoFull from './assets/logo-full.png';
import logoFullOnDark from './assets/logo-full-dark-bg.png';
import logoIcon from './assets/logo-icon.png';
import { getBlob, deleteBlob, persistFromObjectUrl, MediaStoreQuotaError } from './services/mediaStore';
import { subscribeToCampaignMedia, fetchCampaignMedia } from './services/campaignApi';
import { signUpOrganizer, signInOrganizer, signOutOrganizer, restoreOrganizerSession } from './services/authApi';
import { fetchMyCampaigns } from './services/campaignApi';
import { exportProjectData, importProjectData } from './projectBackup';

interface ToastMsg {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning';
  title?: string;
}

// Component Imports
import Celebrations from './components/Celebrations';
import MediaLibrary from './components/MediaLibrary';
import UploadForm from './components/UploadForm';
const Dashboard = lazy(() => import('./components/Dashboard'));
const VideoStudio = lazy(() => import('./components/VideoStudio'));
const SlideshowStudio = lazy(() => import('./components/SlideshowStudio'));
const TextToSpeech = lazy(() => import('./components/TextToSpeech'));
import ThemeSelector from './components/ThemeSelector';
import ReactionRecorder from './components/ReactionRecorder';
const Plans = lazy(() => import('./components/Plans'));
const Profile = lazy(() => import('./components/Profile'));
const Delivery = lazy(() => import('./components/Delivery'));
const Tracker = lazy(() => import('./components/Tracker'));
const ContributorPortal = lazy(() => import('./components/ContributorPortal'));
import CreateCampaign from './components/CreateCampaign';
import ContributorHub from './components/ContributorHub';

export default function App() {
  const ensureUniqueIds = <T extends { id?: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    return items.map(item => {
      let id = item.id;
      while (!id || seen.has(id)) {
        id = (id || 'item') + '_' + Math.random().toString(36).substring(2, 7);
      }
      seen.add(id);
      return { ...item, id };
    });
  };

  // Toast notifications states
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const showToast = (message: string, type: 'success' | 'info' | 'warning' = 'success', title?: string) => {
    const id = 'toast_' + Date.now() + Math.random().toString(36).substr(2, 4);
    setToasts(prev => [...prev, { id, message, type, title }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const isFirstLoadBirthdaysRef = useRef(true);
  const isFirstLoadClipsRef = useRef(true);
  const isFirstLoadEventsRef = useRef(true);

  // Persistence state loaders
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('zz_logged_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn('Failed to parse zz_logged_user from localStorage', e);
      return null;
    }
  });

  const [prefilledContact, setPrefilledContact] = useState<BirthdayContact | null>(null);

  const [events, setEvents] = useState<CelebrativeEvent[]>(() => {
    try {
      const saved = localStorage.getItem('zz_events');
      return ensureUniqueIds(saved ? JSON.parse(saved) : seedData().events);
    } catch (e) {
      console.warn('Failed to parse zz_events from localStorage', e);
      return ensureUniqueIds(seedData().events);
    }
  });

  const [birthdays, setBirthdays] = useState<BirthdayContact[]>(() => {
    try {
      const saved = localStorage.getItem('zz_birthdays');
      return ensureUniqueIds(saved ? JSON.parse(saved) : seedData().birthdays);
    } catch (e) {
      console.warn('Failed to parse zz_birthdays from localStorage', e);
      return ensureUniqueIds(seedData().birthdays);
    }
  });

  const [activity, setActivity] = useState<ActivityFeedItem[]>(() => {
    try {
      const saved = localStorage.getItem('zz_activity');
      return ensureUniqueIds(saved ? JSON.parse(saved) : seedData().activity);
    } catch (e) {
      console.warn('Failed to parse zz_activity from localStorage', e);
      return ensureUniqueIds(seedData().activity);
    }
  });

  const [media, setMedia] = useState<MediaItem[]>(() => {
    try {
      const saved = localStorage.getItem('zz_media');
      return ensureUniqueIds(saved ? JSON.parse(saved) : []);
    } catch (e) {
      console.warn('Failed to parse zz_media from localStorage', e);
      return [];
    }
  });

  // Live cross-device sync: subscribe to real contributor submissions coming in
  // from Supabase for every campaign this organizer currently has loaded, so a
  // wish submitted on a contributor's own phone/laptop shows up here without a
  // manual refresh. Replaces the old handlePortalWishSubmission, which only
  // ever wrote to this tab's own local state.
  const mapDbRowToMediaItem = (row: any): MediaItem => ({
    id: row.id,
    type: row.type,
    name: `${row.from_name}'s Contribution wish`,
    from: row.from_name,
    note: row.note,
    event: row.campaign_id,
    size: row.size_bytes ? `${(row.size_bytes / 1e6).toFixed(1)}MB` : '—',
    dur: row.duration ?? (row.type === 'text' ? 6 : 5),
    // row.resolved_url is a real signed URL, resolved server-round-trip before
    // this ever runs — never null for an item that actually has a file. This
    // is the fix for the "HTMLImageElement is in the broken state" crash in
    // the Studios, which happened because url was previously hardcoded to null.
    url: row.resolved_url || null,
    thumb: row.type === 'photo' ? (row.resolved_url || null) : null,
    textBody: row.text_body,
    style: row.style,
    created: new Date(row.created_at).getTime(),
    approved: row.approved,
  });

  // Initial load: pull in everything already submitted before this dashboard
  // session started (e.g. contributions that arrived while the organizer had
  // the app closed). Without this, only brand-new realtime inserts would ever
  // appear, and a fresh page load would silently show nothing.
  useEffect(() => {
    const campaignIds = events.map(e => e.id);
    if (campaignIds.length === 0) return;

    campaignIds.forEach(campaignId => {
      fetchCampaignMedia(campaignId)
        .then(rows => {
          setMedia(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const fresh = rows.filter((r: any) => !existingIds.has(r.id)).map(mapDbRowToMediaItem);
            return fresh.length ? [...fresh, ...prev] : prev;
          });
        })
        .catch(e => console.warn(`Failed to load existing media for campaign ${campaignId}`, e));
    });
  }, [events.map(e => e.id).join(',')]);

  useEffect(() => {
    const campaignIds = events.map(e => e.id);
    if (campaignIds.length === 0) return;

    const unsubscribers = campaignIds.map(campaignId =>
      subscribeToCampaignMedia(campaignId, (row) => {
        setMedia(prev => {
          if (prev.some(m => m.id === row.id)) return prev; // avoid duplicates on reconnect
          return [mapDbRowToMediaItem(row), ...prev];
        });
        setActivity(prev => [
          {
            id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            type: 'done',
            icon: '📨',
            text: `${row.from_name} submitted a wish through the Contributor Portal`,
            time: 'Just now',
            stage: 'Portal Submission',
          },
          ...prev,
        ]);
        showToast(`${row.from_name} submitted a new ${row.type} wish. Check event dashboard!`, 'success', 'NEW CONTRIBUTOR WISH RECEIVED');
      })
    );

    return () => { unsubscribers.forEach(unsub => unsub()); };
  }, [events.map(e => e.id).join(',')]);

  // UI state managers
  const [activeRole, setActiveRole] = useState<'organizer' | 'contributor'>(() => {
    return (localStorage.getItem('zz_active_role') as 'organizer' | 'contributor') || 'organizer';
  });
  const [currentPage, setCurrentPage] = useState<string>(() => {
    const savedRole = localStorage.getItem('zz_active_role') || 'organizer';
    return savedRole === 'contributor' ? 'contributor-hub' : 'dashboard';
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPortalId, setShowPortalId] = useState<string | null>(null);
  const [hamburgerOpen, setHamburgerOpen] = useState(false);

  // Authentication Fields state
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [loginEmail, setLoginEmail] = useState('adaeze@demo.ng');
  const [loginPassword, setLoginPassword] = useState('demo1234');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPlan, setRegPlan] = useState('gold');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Video Studio timeline clips
  const [studioClips, setStudioClips] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('zz_studio_clips');
      return ensureUniqueIds(saved ? JSON.parse(saved) : []);
    } catch (e) {
      console.warn('Failed to parse zz_studio_clips from localStorage', e);
      return [];
    }
  });
  const [studioTimeline, setStudioTimeline] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('zz_studio_timeline');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to parse zz_studio_timeline from localStorage', e);
      return [];
    }
  });

  // Synchronize dynamic changes into localStorage
  useEffect(() => {
    if (user) {
      localStorage.setItem('zz_logged_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('zz_logged_user');
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('zz_events', JSON.stringify(events));
    if (isFirstLoadEventsRef.current) {
      isFirstLoadEventsRef.current = false;
    } else {
      showToast('Surprise campaign details saved successfully.', 'success', 'AUTOSAVE PERSISTENCE');
    }
  }, [events]);

  useEffect(() => {
    localStorage.setItem('zz_birthdays', JSON.stringify(birthdays));
    if (isFirstLoadBirthdaysRef.current) {
      isFirstLoadBirthdaysRef.current = false;
    } else {
      showToast('Birthday contacts list saved successfully.', 'success', 'AUTOSAVE PERSISTENCE');
    }
  }, [birthdays]);

  useEffect(() => {
    localStorage.setItem('zz_activity', JSON.stringify(activity));
  }, [activity]);

  useEffect(() => {
    localStorage.setItem('zz_media', JSON.stringify(media));
  }, [media]);

  // --- Media blob persistence (IndexedDB) ---------------------------------
  // Object URLs (URL.createObjectURL) die on reload; the metadata above
  // survives via localStorage, but without this, every thumbnail/clip/
  // recording would silently break the moment the tab is closed or refreshed.
  // We mirror any newly-created blob: URL into IndexedDB (keyed by media id),
  // and on the very first mount we look for any media item whose URL is
  // already a dead blob: reference and swap in a fresh URL rebuilt from the
  // IndexedDB copy.
  const persistedMediaIdsRef = useRef<Set<string>>(new Set());
  const prevMediaIdsRef = useRef<Set<string>>(new Set());
  const hasRehydratedRef = useRef(false);

  useEffect(() => {
    if (hasRehydratedRef.current) return;
    hasRehydratedRef.current = true;

    (async () => {
      let restoredCount = 0;
      const updates = new Map<string, { url?: string | null; thumb?: string | null }>();

      for (const item of media) {
        const needsUrl = !!item.url && item.url.startsWith('blob:');
        const needsThumb = !!item.thumb && item.thumb.startsWith('blob:');
        if (!needsUrl && !needsThumb) continue;

        const patch: { url?: string | null; thumb?: string | null } = {};
        if (needsUrl) {
          const blob = await getBlob(item.id);
          if (blob) {
            patch.url = URL.createObjectURL(blob);
            persistedMediaIdsRef.current.add(item.id);
          } else {
            patch.url = null; // no backup exists (e.g. created before this feature) — can't recover it
          }
        }
        if (needsThumb) {
          const thumbBlob = await getBlob(item.id + '_thumb');
          if (thumbBlob) {
            patch.thumb = URL.createObjectURL(thumbBlob);
          } else {
            patch.thumb = null;
          }
        }
        if (Object.keys(patch).length) {
          updates.set(item.id, patch);
          if (patch.url) restoredCount++;
        }
      }

      if (updates.size) {
        setMedia(prev => prev.map(m => {
          const patch = updates.get(m.id);
          return patch ? { ...m, ...patch } : m;
        }));
      }
      if (restoredCount > 0) {
        showToast(`Restored ${restoredCount} media file${restoredCount === 1 ? '' : 's'} from your last session.`, 'success', 'SESSION RESTORED');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const currentIds = new Set(media.map(m => m.id));

    // Persist any brand-new blob: URLs we haven't backed up yet.
    for (const item of media) {
      if (persistedMediaIdsRef.current.has(item.id)) continue;
      if (item.url && item.url.startsWith('blob:')) {
        persistedMediaIdsRef.current.add(item.id);
        persistFromObjectUrl(item.id, item.url).catch(err => {
          if (err instanceof MediaStoreQuotaError) {
            showToast(err.message, 'warning', 'STORAGE FULL');
          }
        });
      }
      if (item.thumb && item.thumb.startsWith('blob:')) {
        persistFromObjectUrl(item.id + '_thumb', item.thumb).catch(() => {});
      }
    }

    // Clean up blobs for media items that were removed.
    for (const oldId of prevMediaIdsRef.current) {
      if (!currentIds.has(oldId)) {
        deleteBlob(oldId);
        deleteBlob(oldId + '_thumb');
        persistedMediaIdsRef.current.delete(oldId);
      }
    }
    prevMediaIdsRef.current = currentIds;
  }, [media]);

  useEffect(() => {
    localStorage.setItem('zz_studio_clips', JSON.stringify(studioClips));
    if (isFirstLoadClipsRef.current) {
      isFirstLoadClipsRef.current = false;
    } else {
      showToast('Video studio timeline changes saved successfully.', 'success', 'AUTOSAVE PERSISTENCE');
    }
  }, [studioClips]);

  useEffect(() => {
    localStorage.setItem('zz_studio_timeline', JSON.stringify(studioTimeline));
  }, [studioTimeline]);

  useEffect(() => {
    localStorage.setItem('zz_active_role', activeRole);
  }, [activeRole]);

  // Auth logins — real, backed by Supabase (see src/services/authApi.ts).
  // Demo Quick-Login below still works locally for a no-signup preview, but
  // any campaign created under a demo account stays local-only, since demo
  // accounts have no real auth.uid() for Supabase's RLS policies to check.
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const profile = await signInOrganizer(loginEmail, loginPassword);
      setUser(profile);
      // Real accounts source media exclusively from Supabase. Clearing here
      // prevents stale local test/demo uploads (accumulated in localStorage
      // from earlier local-only sessions) from ever leaking into a real
      // campaign's Studio timeline or export.
      setMedia([]);
      const myCampaigns = await fetchMyCampaigns();
      setEvents(myCampaigns); // real campaigns replace the local demo/seed list
      setCurrentPage('dashboard');
    } catch (err: any) {
      setAuthError(err?.message || 'Login failed. Please check your email and password.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);
    if (!regName || !regEmail || !regPassword) {
      setAuthError('Name, email, and password are all required.');
      return;
    }
    setAuthSubmitting(true);
    try {
      const profile = await signUpOrganizer(regEmail, regPassword, regName, regPlan);
      setUser(profile);
      setEvents([]); // brand-new organizer genuinely has zero campaigns yet
      setMedia([]); // same reasoning as handleLoginSubmit above
      setCurrentPage('dashboard');
    } catch (err: any) {
      const message = err?.message || 'Sign up failed. Please try again.';
      // "Check your email" isn't a failure - the account/org row were created
      // fine, they just need to confirm before a session can start.
      if (message.startsWith('Account created')) {
        setAuthInfo(message);
      } else {
        setAuthError(message);
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleQuickLogin = (emailKey: string) => {
    const acc = DEMO_ACCOUNTS[emailKey];
    if (acc) {
      // Local-only demo preview — not backed by Supabase, so campaigns made
      // here won't sync cross-device. Use real Sign Up for that.
      setUser(acc);
      setCurrentPage('dashboard');
    }
  };

  const handleLogout = () => {
    signOutOrganizer();
    setUser(null);
    setEvents([]);
    setMedia([]); // don't leave a logged-out browser holding another account's media in memory/localStorage
    setCurrentPage('dashboard');
  };

  // Restore a real Supabase session on page load/refresh, so the organizer
  // doesn't have to log in again every time, and their real campaigns reload.
  useEffect(() => {
    restoreOrganizerSession().then(async (profile) => {
      if (profile) {
        setUser(profile);
        setMedia([]); // same reasoning as handleLoginSubmit above — real session, real media only
        try {
          const myCampaigns = await fetchMyCampaigns();
          setEvents(myCampaigns);
        } catch (e) {
          console.warn('Failed to load campaigns for restored session', e);
        }
      }
    });
  }, []);

  // Add Contact logic
  const handleAddContact = (contact: Omit<BirthdayContact, 'id'>) => {
    const newContact: BirthdayContact = {
      id: 'bd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      ...contact
    };
    setBirthdays(prev => [newContact, ...prev]);
    setActivity(prev => [
      {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type: 'done',
        icon: '🎂',
        text: `Added contact entry: ${contact.name}`,
        time: 'Just now',
        stage: 'Calendar update'
      },
      ...prev
    ]);
  };

  const handlePlanSurprise = (id: string) => {
    const match = birthdays.find(b => b.id === id);
    if (!match) return;
    setPrefilledContact(match);
    setCurrentPage('create');
  };

  const handleDeleteContact = (id: string) => {
    setBirthdays(prev => prev.filter(c => c.id !== id));
  };

  // Save Media uploaded
  const handleSaveMedia = (newObj: any) => {
    const item: MediaItem = {
      id: 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      created: Date.now(),
      ...newObj
    };
    setMedia(prev => [...prev, item]);
    setActivity(prev => [
      {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type: 'done',
        icon: item.type === 'video' ? '🎬' : '🎙️',
        text: `Uploaded raw file: ${item.name}`,
        time: 'Just now',
        stage: 'Library update'
      },
      ...prev
    ]);
  };

  const handleSaveTextMedia = (data: { text: string; from: string; style: string }) => {
    const item: MediaItem = {
      id: 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      type: 'text',
      name: `${data.from}'s Written Wish`,
      from: data.from,
      note: 'Written entry letter',
      event: '',
      size: data.text.length + ' chars',
      dur: 6,
      url: null,
      thumb: null,
      textBody: data.text,
      style: data.style,
      created: Date.now()
    };
    setMedia(prev => [...prev, item]);
    setActivity(prev => [
      {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type: 'done',
        icon: '✍️',
        text: `Added text letter from: ${data.from}`,
        time: 'Just now',
        stage: 'Library update'
      },
      ...prev
    ]);
  };

  const handlePhotosUploaded = async (files: FileList) => {
    const oversized: string[] = [];
    const invalidSignature: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sizeCheck = validateUploadFileSize(file);
      if (!sizeCheck.ok) {
        oversized.push(file.name);
        continue;
      }
      const sigCheck = await validateFileSignature(file, 'photo');
      if (!sigCheck.ok) {
        invalidSignature.push(file.name);
        continue;
      }
      const url = URL.createObjectURL(file);
      const item: MediaItem = {
        id: 'med_photo_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 7),
        type: 'photo',
        name: file.name.replace(/\.[^.]+$/, ''),
        from: user?.name || 'Manager',
        note: 'Uploaded photo asset',
        event: 'General',
        size: (file.size / 1024 / 1024).toFixed(1) + ' MB',
        dur: 0,
        url: url,
        thumb: url,
        created: Date.now()
      };
      setMedia(prev => [...prev, item]);
    }
    if (oversized.length > 0) {
      alert(`⚠️ Skipped ${oversized.length} file(s) over the ${MAX_UPLOAD_FILE_SIZE_MB}MB limit: ${oversized.join(', ')}`);
    }
    if (invalidSignature.length > 0) {
      alert(`⚠️ Skipped ${invalidSignature.length} file(s) that don't look like real images (renamed/corrupted?): ${invalidSignature.join(', ')}`);
    }
  };

  // Selection managers
  const handleToggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    setMedia(prev => prev.filter(m => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
  };

  const handleClearDeliveredCache = () => {
    const deliveredEventIds = new Set(events.filter(e => e.status === 'delivered').map(e => e.id));
    setMedia(prev => prev.filter(m => !m.event || !deliveredEventIds.has(m.event)));
    showToast('Delivered campaign raw cache cleaned successfully!', 'success', 'CACHE CLEANER');
  };

  const handleUseSelectionInStudio = () => {
    const filtered = media.filter(m => selectedIds.has(m.id) && m.type === 'video');
    const newClips = filtered.map(item => ({
      id: item.id,
      file: item.file || null,
      url: item.url,
      dur: item.dur || 5,
      name: item.name,
      thumb: item.thumb,
      trimStart: 0,
      trimEnd: item.dur || 5,
      transition: 'fade'
    }));

    setStudioClips(prev => [...prev, ...newClips]);
    setStudioTimeline(prev => [...prev, ...newClips.map((_, i) => prev.length + i)]);
    setSelectedIds(new Set());
    setCurrentPage('studio');
  };

  // Video Studio clips loader trigger
  const handleAddNewClip = async (file: File) => {
    const isZip = /\.zip$/i.test(file.name) || /zip/i.test(file.type);
    if (isZip) {
      showToast(`Unpacking ${file.name}...`, 'info', 'READING ARCHIVE');
      try {
        const { files, skippedNames } = await extractMediaFilesFromZip(file);
        if (files.length === 0) {
          alert(`⚠️ "${file.name}" doesn't contain any videos, photos, or audio files ZippZap recognizes (checked ${skippedNames.length} item${skippedNames.length === 1 ? '' : 's'} inside).`);
          return;
        }
        for (const extracted of files) {
          await handleAddNewClip(extracted);
        }
        showToast(
          `Added ${files.length} file${files.length === 1 ? '' : 's'} from ${file.name}` +
            (skippedNames.length > 0 ? ` (skipped ${skippedNames.length} unsupported item${skippedNames.length === 1 ? '' : 's'})` : ''),
          'success',
          'ARCHIVE UNPACKED'
        );
      } catch (err: any) {
        alert(`⚠️ Couldn't read "${file.name}" as a zip archive: ${err?.message || err}`);
      }
      return;
    }

    const sizeCheck = validateUploadFileSize(file);
    if (!sizeCheck.ok) {
      alert(`⚠️ ${sizeCheck.reason}`);
      return;
    }
    const countCheck = checkTimelineClipCountBudget(studioClips.length);
    if (!countCheck.ok && !window.confirm(`⚠️ ${countCheck.reason}\n\nAdd it anyway?`)) {
      return;
    }

    const url = URL.createObjectURL(file);
    
    // Dynamically resolve type from file properties
    let type: 'video' | 'photo' | 'audio' | 'text' = 'video';
    if (file.type.startsWith('image/')) {
      type = 'photo';
    } else if (file.type.startsWith('audio/')) {
      type = 'audio';
    } else if (file.type.startsWith('video/')) {
      type = 'video';
    } else {
      // Fallback detection using file extension
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg'].includes(ext)) {
        type = 'photo';
      } else if (ext && ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'].includes(ext)) {
        type = 'audio';
      }
    }

    const sigCheck = await validateFileSignature(file, type);
    if (!sigCheck.ok) {
      alert(`⚠️ ${sigCheck.reason}`);
      return;
    }

    const item = {
      id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      type,
      file,
      url,
      dur: type === 'photo' ? 5 : 10, // Good default durations depending on type
      name: file.name,
      thumb: type === 'photo' ? url : null,
      trimStart: 0,
      trimEnd: type === 'photo' ? 5 : 10,
      transition: 'fade'
    };
    setStudioClips(prev => [...prev, item]);
    setStudioTimeline(prev => [...prev, prev.length]);
  };

  // Delivery trigger
  const handleMarkDelivered = (id: string) => {
    setEvents(prev =>
      prev.map(e => (e.id === id ? { ...e, status: 'delivered', pipeline: 5 } : e))
    );
    setActivity(prev => [
      {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type: 'done',
        icon: '🚀',
        text: 'Surprise delivery fired to celebrant!',
        time: 'Just now',
        stage: 'Delivery pipeline complete'
      },
      ...prev
    ]);
  };

  // handlePortalWishSubmission was removed: ContributorPortal now submits
  // directly to Supabase via submitContribution(), and the live-subscription
  // effect above (subscribeToCampaignMedia) is what adds the item to `media`
  // and fires the toast — for real, from any device, not just this tab.

  // Prebuilt soundtrack clicker inside Studio/Slideshow
  const handleUsePrebuiltSoundtrack = (musicId: string) => {
    setActivity(prev => [
      {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type: 'done',
        icon: '🎵',
        text: `Loaded surprise background track ID: ${musicId}`,
        time: 'Just now',
        stage: 'Vocal/Mix updates'
      },
      ...prev
    ]);
  };

  // Navigation Options configurations grouped by logical workspace chapters
  const NAV_SECTIONS = activeRole === 'organizer' ? [
    {
      title: 'Core chapters',
      items: [
        { id: 'dashboard', l: 'Dashboard hub', icon: '📊' },
        { id: 'birthdays', l: 'Calendar Campaigns', icon: '🎂' },
        { id: 'tracker', l: 'Pipeline logs', icon: '📈' }
      ]
    },
    {
      title: 'Creative studios',
      items: [
        { id: 'studio', l: 'Video Stitcher', icon: '🎬' },
        { id: 'slideshow', l: 'Slideshow Creator', icon: '🖼️' },
        { id: 'tts', l: 'Synthesizer TTS', icon: '🔊' }
      ]
    },
    {
      title: 'Media & wishes bin',
      items: [
        { id: 'library', l: 'Media Vault', icon: '🗂️' },
        { id: 'upload', l: 'Upload Wishes', icon: '📤' }
      ]
    },
    {
      title: 'Fulfillment',
      items: [
        { id: 'delivery', l: 'Surprise Dispatch', icon: '🚀' }
      ]
    },
    {
      title: 'Account & Colors',
      items: [
        { id: 'profile', l: 'Member Profile', icon: '👤' },
        { id: 'plans', l: 'Pricing Tiers', icon: '⭐' },
        { id: 'themes', l: 'Canvas Theme', icon: '🎨' }
      ]
    }
  ] : [
    {
      title: 'Contributor Space',
      items: [
        { id: 'contributor-hub', l: 'Campaign Portal', icon: '🎁' },
        { id: 'upload', l: 'Upload Wishes', icon: '📤' },
        { id: 'tts', l: 'Synthesizer TTS', icon: '🔊' }
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-[#FFF8F0] text-[#1C1207] font-sans antialiased flex flex-col">
      
      {/* AUTH SCREEN COVER */}
      {!user && (
        <div className="fixed inset-0 bg-[#FFF8F0] z-[9999] flex flex-col lg:flex-row shadow-2xl">
          {/* Left panel branding */}
          <div className="lg:w-[420px] bg-slate-950 p-8 flex flex-col justify-between text-white relative overflow-hidden shrink-0">
            <div className="space-y-1">
              <img src={logoFullOnDark} alt="Zipp Zap" className="h-8 w-auto select-none" draggable={false} />
              <p className="text-xs text-slate-400">Perfect team and group surprises balance manager</p>
            </div>

            <div className="space-y-4 py-8 lg:py-0 select-none">
              <div className="flex gap-3 items-start bg-white/5 border border-white/10 rounded-2xl p-4">
                <span className="text-2xl">🎂</span>
                <div>
                  <h4 className="text-xs font-bold text-white">Upcoming Calendars</h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">Never lose track of important celebration countdown benchmarks.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-white/5 border border-white/10 rounded-2xl p-4">
                <span className="text-2xl">🤵</span>
                <div>
                  <h4 className="text-xs font-bold text-white">Surprise Milestones</h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">Monitor wish collection workflows in beautiful pipelines graphs.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-white/5 border border-white/10 rounded-2xl p-4">
                <span className="text-2xl">🎬</span>
                <div>
                  <h4 className="text-xs font-bold text-white">Canvas Stitcher engine</h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">Merge audio sound mixers, voice clips, subtitles, and picture frames into high quality output.</p>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-500">Trusted by thousands for life's special moments ⭐⭐⭐⭐⭐</p>
          </div>

          {/* Right form layout */}
          <div className="flex-1 overflow-y-auto px-6 py-12 flex items-center justify-center bg-white shadow-inner">
            <div className="w-full max-w-sm space-y-6">
              <div className="space-y-1.5 text-center lg:text-left">
                <h1 className="text-xl md:text-2xl font-black">Plan matching surprises</h1>
                <p className="text-xs text-slate-500">Log in or generate a guest profile to start organizing celebration campaigns</p>
              </div>

              {/* Login / Register selector toggler */}
              <div className="flex bg-[#FFF8F0]/80 p-1 border border-slate-100 rounded-xl max-w-xs mx-auto lg:mx-0">
                <button
                  onClick={() => setAuthTab('login')}
                  className={`flex-1 text-center py-2.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    authTab === 'login' ? 'bg-white shadow-md text-stone-900' : 'text-slate-500'
                  }`}
                >
                  Log In
                </button>
                <button
                  onClick={() => setAuthTab('signup')}
                  className={`flex-1 text-center py-2.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    authTab === 'signup' ? 'bg-white shadow-md text-stone-900' : 'text-slate-500'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              {authTab === 'login' ? (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {authError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold px-3 py-2 rounded-lg">
                      ⚠️ {authError}
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Email address *</label>
                    <input
                      type="email"
                      required
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50"
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50"
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow cursor-pointer transition flex items-center justify-center"
                  >
                    {authSubmitting ? 'Authenticating…' : 'Authenticate Entry'}
                  </button>

                  <div className="border-t border-slate-100/50 pt-5 space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Fast Entry Profiles (local preview only)</p>
                    <p className="text-[9px] text-amber-600 text-center -mt-1">⚠️ Not a real account — campaigns made here stay on this device only. Sign up above for real, cross-device campaigns.</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => handleQuickLogin('adaeze@demo.ng')}
                        className="py-2.5 bg-slate-50 border border-slate-150 hover:bg-slate-100 rounded-xl text-[10px] font-bold transition flex items-center justify-center cursor-pointer text-slate-700"
                      >
                        👩 Adaeze
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickLogin('silver@demo.ng')}
                        className="py-2.5 bg-slate-50 border border-slate-150 hover:bg-slate-100 rounded-xl text-[10px] font-bold transition flex items-center justify-center cursor-pointer text-slate-700"
                      >
                        👨 Chuks
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickLogin('diamond@demo.ng')}
                        className="py-2.5 bg-slate-50 border border-slate-150 hover:bg-slate-100 rounded-xl text-[10px] font-bold transition flex items-center justify-center cursor-pointer text-slate-700"
                      >
                        👩 Ngozi
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleSignupSubmit} className="space-y-4">
                  {authError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold px-3 py-2 rounded-lg">
                      ⚠️ {authError}
                    </div>
                  )}
                  {authInfo && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold px-3 py-2 rounded-lg">
                      ✅ {authInfo}
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">First Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Oluwaseun"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50"
                      value={regName}
                      onChange={e => setRegName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Email *</label>
                    <input
                      type="email"
                      required
                      placeholder="name@celebrate.com"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-600"
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="Min 8 characters required"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-600"
                      value={regPassword}
                      onChange={e => setRegPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Choose Plan Tier</label>
                    <div className="grid grid-cols-2 gap-2 mt-2 select-none">
                      <div
                        onClick={() => setRegPlan('standard')}
                        className={`p-3.5 border rounded-xl cursor-pointer text-center transition ${
                          regPlan === 'standard' ? 'border-indigo-600 bg-indigo-50/20' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span className="text-xl">⭐</span>
                        <div className="text-[10px] font-bold">Standard</div>
                      </div>
                      <div
                        onClick={() => setRegPlan('gold')}
                        className={`p-3.5 border rounded-xl cursor-pointer text-center transition ${
                          regPlan === 'gold' ? 'border-indigo-600 bg-indigo-50/20' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span className="text-xl">🥇</span>
                        <div className="text-[10px] font-bold">Gold Plan</div>
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow transition mt-2 cursor-pointer flex items-center justify-center"
                  >
                    {authSubmitting ? 'Creating account…' : 'Generate Account Entry'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 select-none shadow-xs w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            
            {/* Branding Logo Block */}
            <div className="flex items-center gap-3">
              <div
                onClick={() => setCurrentPage('dashboard')}
                className="cursor-pointer flex items-center"
                title="Zipp Zap"
              >
                <img src={logoIcon} alt="" aria-hidden="true" className="h-8 w-8 md:h-9 md:w-9 select-none" draggable={false} />
              </div>
              <div onClick={() => setCurrentPage('dashboard')} className="cursor-pointer">
                <img src={logoFull} alt="Zipp Zap" className="h-4 md:h-5 w-auto select-none" draggable={false} />
                <p className="hidden xs:block text-[8px] font-black text-indigo-600 uppercase tracking-widest mt-1">TEAM CAMPAIGNS</p>
              </div>
            </div>

            {/* Dynamic Interactive Role Switcher */}
            <div className="flex items-center gap-1 bg-slate-100/90 p-1 border border-slate-200/50 rounded-xl select-none shrink-0 shadow-inner">
              <button
                type="button"
                onClick={() => {
                  setActiveRole('organizer');
                  setCurrentPage('dashboard');
                  showToast('Switched workspace view to Campaign Organizer 👑', 'info', 'ROLE MANAGER');
                }}
                className={`px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
                  activeRole === 'organizer'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-850 hover:bg-slate-200/50'
                }`}
                title="Manage Campaigns, stitch videos, edit slideshows & deliver surprises"
              >
                <span>👑</span>
                <span className="hidden xs:inline">Organizer</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRole('contributor');
                  setCurrentPage('contributor-hub');
                  showToast('Switched workspace view to Guest Contributor 🎁', 'info', 'ROLE MANAGER');
                }}
                className={`px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
                  activeRole === 'contributor'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-850 hover:bg-slate-200/50'
                }`}
                title="Select active campaign, record/upload video greetings & write letters"
              >
                <span>🎁</span>
                <span className="hidden xs:inline">Contributor</span>
              </button>
            </div>

            {/* Right side controls (User, Premium, Hamburger menu) */}
            <div className="flex items-center gap-2 md:gap-3">
              {user && (
                <div 
                  onClick={() => setCurrentPage('profile')}
                  className="hidden sm:flex items-center gap-2.5 bg-[#FFF8F0]/80 hover:bg-[#FFF8F0] border border-indigo-100/40 px-3 py-1.5 rounded-xl cursor-pointer transition select-none"
                >
                  <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-[10px] font-black uppercase">
                    {user.name.charAt(0)}
                  </div>
                  <div className="text-left">
                    <div className="text-[10px] font-extrabold text-slate-850 leading-none">{user.name}</div>
                    <div className="text-[8px] font-black text-indigo-600 uppercase mt-0.5 tracking-wider">{user.tier} Account</div>
                  </div>
                </div>
              )}

              {/* Profile Avatar Trigger (Mobile icon view) */}
              {user && (
                <button 
                  onClick={() => setCurrentPage('profile')}
                  className="sm:hidden w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 font-black text-xs flex items-center justify-center active:scale-95 transition"
                  title="Profile Setup"
                >
                  {user.name.charAt(0).toUpperCase()}
                </button>
              )}

              {/* Responsive Menu Dropdown button for all chapters */}
              <button
                onClick={() => setHamburgerOpen(!hamburgerOpen)}
                aria-expanded={hamburgerOpen}
                aria-haspopup="true"
                className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 text-slate-800 font-extrabold text-[11px] active:scale-95 transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>{hamburgerOpen ? '✕ Wrap navigation' : '☰ Page directory'}</span>
              </button>
            </div>

          </div>
        </div>

        {/* Sub-navigation bar: A beautiful horizontal scrolling quick switcher of channels */}
        <div className="bg-slate-50 border-t border-slate-100 px-1 py-1 sm:py-1.5">
          <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
            <nav aria-label="Section quick switcher" className="flex items-center gap-1.5 overflow-x-auto pb-1.5 pt-0.5 scrollbar-none snap-x select-none w-full">
              {NAV_SECTIONS.flatMap(sec => sec.items).map(nav => {
                const isActive = currentPage === nav.id;
                return (
                  <button
                    key={nav.id}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      setCurrentPage(nav.id);
                      setHamburgerOpen(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[10.5px] font-bold tracking-wide flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer snap-start border ${
                      isActive 
                        ? 'bg-indigo-600 text-white shadow-xs border-indigo-700 font-black' 
                        : 'bg-white hover:bg-[#FFF8F0]/30 hover:text-indigo-600 text-slate-700 border-slate-200'
                    }`}
                  >
                    <span className="text-sm shrink-0" aria-hidden="true">{nav.icon}</span>
                    <span>{nav.l}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Full Workspace Chapters Overlay Menu Drawer (Accessible on ALL Viewports) */}
      {hamburgerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop blur overlay */}
          <div 
            onClick={() => setHamburgerOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300"
            aria-hidden="true"
          />

          {/* Drawer sheet content container */}
          <div className="relative flex flex-col max-w-[320px] w-full bg-white border-l border-slate-200 h-full p-6 shadow-2xl z-50 animate-in slide-in-from-right duration-200 select-none overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <img src={logoIcon} alt="" aria-hidden="true" className="w-8 h-8 select-none" draggable={false} />
                <div>
                  <img src={logoFull} alt="Zipp Zap" className="h-3.5 w-auto select-none" draggable={false} />
                  <p className="text-[8px] text-slate-400 font-bold tracking-wide uppercase mt-0.5">SURPRISE PORTAL</p>
                </div>
              </div>
              <button 
                onClick={() => setHamburgerOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-50 border border-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 transition"
                title="Close sheet"
                aria-label="Close navigation menu"
              >
                ✕
              </button>
            </div>

            {/* Structured Chapters menu inside sidebar drawer */}
            <div className="space-y-4 flex-1">
              {NAV_SECTIONS.map((section, idx) => (
                <div key={idx} className="space-y-1">
                  <span className="px-2 text-[8px] font-black tracking-widest text-slate-400 uppercase leading-none block py-1 mt-1">
                    {section.title}
                  </span>
                  {section.items.map(nav => {
                    const isActive = currentPage === nav.id;
                    return (
                      <button
                        key={nav.id}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => {
                          setCurrentPage(nav.id);
                          setHamburgerOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer border ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-xs font-black border-indigo-700'
                            : 'text-slate-700 hover:bg-[#FFF8F0]/30 hover:text-indigo-600 border-transparent'
                        }`}
                      >
                        <span className="text-sm shrink-0" aria-hidden="true">{nav.icon}</span>
                        <span className="truncate">{nav.l}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Profile banner footer in mobile drawer */}
            {user && (
              <div className="pt-4 border-t border-slate-100 mt-4 shrink-0">
                <div
                  onClick={() => {
                    setCurrentPage('profile');
                    setHamburgerOpen(false);
                  }}
                  className="bg-[#FFF8F0]/60 hover:bg-[#FFF8F0] border border-indigo-100/30 p-3 rounded-2xl flex items-center gap-3 transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-black text-xs flex items-center justify-center">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-extrabold text-slate-900 truncate leading-tight">{user.name}</h4>
                    <p className="text-[9px] text-slate-400 capitalize mt-0.5 font-bold">Tier: {user.tier}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Workspace component renderer container.
          NOTE: deliberately no overflow-y here. The outer shell uses min-h-screen (grows with
          content) rather than a fixed h-screen, so this element's content was never actually
          clipped/scrolling internally - real page scrolling has always happened at the document
          level. `overflow-y-auto` here was a no-op for visible behavior but a real bug for any
          descendant using `position: sticky`: any ancestor with overflow != visible establishes
          its own scroll-container context, which sticky positioning is computed relative to -
          since this element's own scrollTop never moves, every sticky descendant in the app
          was silently inert (verified: getBoundingClientRect().top tracked scroll 1:1, no stick). */}
      <main className="flex-grow p-4 md:p-8 max-w-7xl mx-auto w-full md:max-w-none space-y-6 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="space-y-6"
          >
            {/* COMPONENT VIEWER GATE */}
            <Suspense fallback={
              <div className="flex items-center justify-center py-24">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-[3px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                  <p className="text-xs font-semibold text-slate-400">Loading...</p>
                </div>
              </div>
            }>
            {currentPage === 'contributor-hub' && activeRole === 'contributor' && (
              <ContributorHub
                events={events}
                onOpenPortal={setShowPortalId}
                onNavigate={setCurrentPage}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'dashboard' && (
              <Dashboard
                user={user}
                events={events}
                onUpdateEvents={setEvents}
                activity={activity}
                media={media}
                points={user?.points || 0}
                monthlyMsgCount={user?.monthlyMsgCount || 0}
                onNavigate={setCurrentPage}
                onOpenPortal={setShowPortalId}
                onUpdateClipsState={setStudioClips}
                onUpdateTimelineState={setStudioTimeline}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'birthdays' && (
              <Celebrations
                birthdays={birthdays}
                onAddContact={handleAddContact}
                onPlanSurprise={handlePlanSurprise}
                onDeleteContact={handleDeleteContact}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'library' && (
              <MediaLibrary
                media={media}
                events={events}
                onClearDeliveredCache={handleClearDeliveredCache}
                onDeleteMedia={id => setMedia(prev => prev.filter(m => m.id !== id))}
                onUpdateMedia={(id, updates) => setMedia(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))}
                onAddToStudio={id => {
                  const item = media.find(m => m.id === id);
                  if (item?.type === 'video') {
                    const clip = {
                      id: item.id,
                      file: item.file || null,
                      url: item.url,
                      dur: item.dur || 10,
                      name: item.name,
                      thumb: item.thumb,
                      trimStart: 0,
                      trimEnd: item.dur || 10,
                      transition: 'fade'
                    };
                    setStudioClips(prev => [...prev, clip]);
                    setStudioTimeline(prev => [...prev, prev.length]);
                    alert('🎬 Video added to Studio pipeline!');
                  }
                }}
                onAddToSlideshow={id => {
                  const item = media.find(m => m.id === id);
                  if (item?.type === 'photo') {
                    alert('📸 Photo included in your slideshow project timeline!');
                  }
                }}
                onPreviewMedia={id => {
                  const item = media.find(m => m.id === id);
                  if (item?.url) alert(`Previewing item: ${item.name}`);
                }}
                selectedIds={selectedIds}
                onToggleSelection={handleToggleSelection}
                onClearSelection={() => setSelectedIds(new Set())}
                onDeleteSelected={handleDeleteSelected}
                onUseSelectionInStudio={handleUseSelectionInStudio}
                onUseSelectionInSlideshow={() => {
                  setSelectedIds(new Set());
                  setCurrentPage('slideshow');
                }}
                onNavigate={setCurrentPage}
              />
            )}

            {currentPage === 'upload' && (
              <UploadForm
                onSaveMedia={handleSaveMedia}
                onSaveTextMedia={handleSaveTextMedia}
                onPhotosUploaded={handlePhotosUploaded}
                recentMedia={media}
                user={user}
                onNavigate={setCurrentPage}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'studio' && (
              <VideoStudio
                media={media}
                onAddNewClip={handleAddNewClip}
                timelineOrder={studioTimeline}
                clips={studioClips}
                onUpdateClipsState={setStudioClips}
                onUpdateTimelineState={setStudioTimeline}
                onClearTimelineAll={() => {
                  setStudioClips([]);
                  setStudioTimeline([]);
                }}
                brand={{ brandColor: user?.brandColor, brandLogoDataUrl: user?.brandLogoDataUrl }}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'slideshow' && (
              <SlideshowStudio
                media={media}
                events={events}
                onAddNewPhoto={file => {
                  const url = URL.createObjectURL(file);
                  const item: MediaItem = {
                    id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                    type: 'photo',
                    name: file.name,
                    from: 'Manager upload',
                    note: '',
                    event: '',
                    size: (file.size / 1024 / 1024).toFixed(1) + ' MB',
                    dur: 0,
                    url,
                    thumb: url,
                    created: Date.now()
                  };
                  setMedia(prev => [...prev, item]);
                }}
                onClearSlideshowPics={() => {
                  setMedia(prev => prev.filter(m => m.type !== 'photo'));
                }}
                onUsePrebuiltSurpriseAudioSound={handleUsePrebuiltSoundtrack}
              />
            )}

            {currentPage === 'tts' && (
              <TextToSpeech
                onSaveVoiceClip={(txt, duration, audioBlob, fileUrl) => {
                  const item: MediaItem = {
                    id: 'media_tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                    type: 'audio',
                    name: `Synthesised Wish`,
                    from: user?.name || 'Synthesizer',
                    note: txt,
                    event: '',
                    size: (audioBlob.size / 1024).toFixed(0) + ' KB',
                    dur: duration,
                    url: fileUrl,
                    thumb: null,
                    created: Date.now()
                  };
                  setMedia(prev => [...prev, item]);
                }}
                media={media}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'themes' && (
              <ThemeSelector onThemeChange={the => console.log('Theme changed to:', the)} />
            )}

            {activeRole === 'organizer' && currentPage === 'create' && (
              <CreateCampaign
                onAddEvent={(newEvent) => {
                  setEvents(prev => [newEvent, ...prev]);
                  setActivity(prev => [
                    {
                      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                      type: 'done',
                      icon: '🚀',
                      text: `Initiated active surprise campaign: ${newEvent.title}`,
                      time: 'Just now',
                      stage: 'Campaign live'
                    },
                    ...prev
                  ]);
                }}
                onNavigate={setCurrentPage}
                prefilledContact={prefilledContact}
                onClearPrefilledContact={() => setPrefilledContact(null)}
                isRealAccount={!!user?.id}
              />
            )}

            {currentPage === 'profile' && (
              <Profile
                user={user}
                onSaveProfile={prof => {
                  if (user) {
                    setUser({ ...user, name: prof.name, phone: prof.phone, city: prof.city, brandLogoDataUrl: prof.brandLogoDataUrl, brandColor: prof.brandColor });
                  }
                }}
                onLogout={handleLogout}
                onExportProject={async () => {
                  try {
                    const { fileName, mediaCount } = await exportProjectData();
                    showToast(`Saved ${fileName} (${mediaCount} media file${mediaCount === 1 ? '' : 's'} included).`, 'success', 'BACKUP DOWNLOADED');
                  } catch (e: any) {
                    showToast(e?.message || 'Could not export your project backup.', 'warning', 'EXPORT FAILED');
                  }
                }}
                onImportProject={async file => {
                  try {
                    const { mediaCount, keyCount } = await importProjectData(file);
                    showToast(`Restored ${keyCount} saved item${keyCount === 1 ? '' : 's'} and ${mediaCount} media file${mediaCount === 1 ? '' : 's'}. Reloading…`, 'success', 'BACKUP RESTORED');
                    setTimeout(() => window.location.reload(), 1200);
                  } catch (e: any) {
                    showToast(e?.message || 'Could not restore that backup file.', 'warning', 'RESTORE FAILED');
                  }
                }}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'plans' && (
              <Plans
                user={user}
                onUpgradePlan={tierId => {
                  if (user) {
                    setUser({ ...user, tier: tierId });
                  }
                }}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'delivery' && (
              <Delivery
                events={events}
                onMarkDelivered={handleMarkDelivered}
                onOpenPortal={setShowPortalId}
              />
            )}

            {activeRole === 'organizer' && currentPage === 'tracker' && (
              <Tracker events={events} activity={activity} />
            )}

            {/* ACCESS RESTRICTION GUARD */}
            {activeRole === 'contributor' && [
              'dashboard', 'birthdays', 'tracker', 'studio', 'slideshow', 
              'library', 'delivery', 'plans', 'themes', 'create'
            ].includes(currentPage) && (
              <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-md mx-auto text-center space-y-5 shadow-sm animate-in fade-in duration-200">
                <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-3xl mx-auto text-rose-500">
                  🔒
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Campaign Organizer Access Required</h3>
                  <p className="text-xs text-slate-500 font-sans leading-relaxed">
                    The page <strong className="text-rose-600">{currentPage.toUpperCase()}</strong> contains administrative timeline stitching, custom soundtrack mixers, or dispatch delivery tools that are restricted to Group Organizers only.
                  </p>
                </div>
                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveRole('organizer');
                      setCurrentPage('dashboard');
                      showToast('Switched workspace view to Campaign Organizer 👑', 'info', 'ROLE MANAGER');
                    }}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition cursor-pointer"
                  >
                    👑 Switch to Organizer Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage('contributor-hub')}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    🎁 Back to Contributor Hub
                  </button>
                </div>
              </div>
            )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

       {/* Contributor Portal Display over screen */}
      {showPortalId && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950">
            <div className="w-8 h-8 border-[3px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        }>
        <ContributorPortal
          onBackToHome={() => setShowPortalId(null)}
          celebrantName={events.find(e => e.id === showPortalId)?.cel || 'Celebrant'}
          occasion={events.find(e => e.id === showPortalId)?.occ || 'Birthday'}
          eventId={showPortalId}
          allWishes={media}
          onDeleteWish={id => {
            setMedia(prev => prev.filter(m => m.id !== id));
            showToast('Wish contribution successfully removed by organizer.', 'warning', 'PORTAL MANAGER');
          }}
        />
        </Suspense>
      )}

      {/* Toast Notification Container in bottom-right corner */}
      <div className="fixed bottom-6 right-6 z-[60] w-80 space-y-3 pointer-events-none" id="global-toasts-container">
        {toasts.map(t => (
          <div
            key={t.id}
            className="pointer-events-auto bg-slate-900 border border-slate-800 text-white rounded-2xl p-4 shadow-xl flex gap-3 items-start animate-in slide-in-from-bottom duration-300 relative overflow-hidden"
          >
            {/* Ambient accent background colors conforming to type */}
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
              t.type === 'success' ? 'bg-emerald-500' : t.type === 'warning' ? 'bg-amber-500' : 'bg-indigo-500'
            }`} />
            
            <div className="shrink-0 text-sm">
              {t.type === 'success' ? '✅' : t.type === 'warning' ? '⚠️' : 'ℹ️'}
            </div>
            
            <div className="flex-1 space-y-0.5">
              {t.title && <h5 className="text-[9px] font-black uppercase tracking-wider text-slate-400 select-none">{t.title}</h5>}
              <p className="text-[11px] font-bold text-slate-100 leading-normal">{t.message}</p>
            </div>
            
            <button
              onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              className="text-slate-400 hover:text-white font-extrabold text-xs ml-2 shrink-0 self-center cursor-pointer"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
