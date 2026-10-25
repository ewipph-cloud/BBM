
"use client";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp as realtimeTimestamp,
  set,
} from "firebase/database";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Camera,
  Check,
  CircleAlert,
  ChevronRight,
  FileText,
  Image,
  Lock,
  MessageCircle,
  MessageSquare,
  Moon,
  Phone,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Star,
  Users,
  Video,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { auth, db, firebaseReady, realtimeDb } from "@/lib/firebase";

type TabId = "obrolan" | "status" | "panggilan" | "kontak" | "pengaturan";

type Contact = {
  id: string;
  name: string;
  initials: string;
  color: string;
  email?: string;
  online?: boolean;
  statusLabel?: string;
};

type ChatRow = {
  id: string;
  name: string;
  initials: string;
  color: string;
  time: string;
  preview: string;
  members: string[];
  memberEmails: Record<string, string>;
  lastMessage?: string;
  lastMessageType?: "text" | "ping";
  lastMessageSenderId?: string;
  lastMessageId?: string;
  updatedAt?: Timestamp | null;
  unread?: number;
  pinned?: boolean;
};

type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  type?: "ping";
  createdAt?: Timestamp | null;
};

type PresenceMap = Record<string, { state?: string }>;

const settingItems = [
  { label: "Pesan berbintang", icon: Star, tint: "#f7e6ad", extra: false },
  { label: "Obrolan tersimpan", icon: FileText, tint: "#dfe7f0", extra: false },
  { label: "Perangkat tertaut", icon: PhoneCall, tint: "#d5ebea", extra: "2 aktif" },
  { label: "Privasi & keamanan", icon: Lock, tint: "#d8f0e1", extra: false },
  { label: "Notifikasi", icon: Bell, tint: "#f5dada", extra: false },
  { label: "Mode gelap", icon: Moon, tint: "#e7dff7", toggle: true },
  { label: "Penyimpanan & data", icon: FileText, tint: "#f7e5c8", extra: "1,2 GB" },
  { label: "Bantuan & umpan balik", icon: Search, tint: "#dbeafc", extra: false },
  { label: "Keluar", icon: PhoneCall, tint: "#f8dfe3", extra: false, danger: true },
];

const navItems: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "obrolan", label: "Obrolan", icon: MessageSquare },
  { id: "status", label: "Status", icon: Bell },
  { id: "panggilan", label: "Panggilan", icon: Phone },
  { id: "kontak", label: "Kontak", icon: Users },
  { id: "pengaturan", label: "Pengaturan", icon: Settings },
];

const friendlyError = (error: unknown) => {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const messages: Record<string, string> = {
    "auth/email-already-in-use": "Email ini sudah terdaftar.",
    "auth/invalid-credential": "Email atau kata sandi salah.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/weak-password": "Kata sandi minimal 6 karakter.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "permission-denied": "Akses ditolak. Periksa Firebase Security Rules.",
  };
  return (
    messages[code] ??
    (error instanceof Error && !("code" in error)
      ? error.message
      : "Terjadi kesalahan. Silakan coba lagi.")
  );
};

const formatTime = (timestamp?: Timestamp | null) =>
  timestamp
    ? new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(timestamp.toDate())
    : "";

const avatarColor = (value: string) => {
  const colors = ["#e7a78b", "#8fae99", "#a69bd0", "#d99baf", "#6da8b5"];
  const hash = [...value].reduce((total, character) => total + character.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

function playPingTone(context: AudioContext) {
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  const start = context.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(1046.5, start);
  oscillator.frequency.setValueAtTime(1318.5, start + 0.11);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
  volume.gain.setValueAtTime(0.13, start + 0.12);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.33);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("obrolan");
  const [searchQuery, setSearchQuery] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [chatRows, setChatRows] = useState<ChatRow[]>([]);
  const [contactList, setContactList] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<PresenceMap>({});
  const [draft, setDraft] = useState("");
  const [contactIdentifier, setContactIdentifier] = useState("");
  const [chatError, setChatError] = useState("");
  const [sending, setSending] = useState(false);
  const [userPin, setUserPin] = useState("");
  const [pinCopied, setPinCopied] = useState(false);
  const [pingSoundEnabled, setPingSoundEnabled] = useState(false);
  const [pingFlash, setPingFlash] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pingSoundEnabledRef = useRef(false);
  const seenPingIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setChatRows([]);
      setContactList([]);
      setUserPin("");
      return;
    }

    const chatsQuery = query(
      collection(db, "chats"),
      where("members", "array-contains", user.uid),
    );
    let initialSnapshot = true;
    const stopChats = onSnapshot(
      chatsQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((chatDoc) => {
          const data = chatDoc.data() as Omit<ChatRow, "id" | "name" | "initials" | "color" | "time" | "preview">;
          const otherId = data.members.find((member) => member !== user.uid) ?? "";
          const name = data.memberEmails[otherId] ?? "Pengguna";
          const lastMessage =
            data.lastMessageType === "ping"
              ? "BBM Ping!"
              : `${data.lastMessageSenderId === user.uid ? "Anda: " : ""}${data.lastMessage ?? "Mulai percakapan"}`;
          return {
            ...data,
            id: chatDoc.id,
            name,
            initials: name.slice(0, 2).toUpperCase(),
            color: avatarColor(name),
            time: formatTime(data.updatedAt),
            preview: lastMessage,
          };
        });
        if (initialSnapshot) {
          for (const row of rows) {
            if (row.lastMessageType === "ping" && row.lastMessageId) {
              seenPingIdsRef.current.add(row.lastMessageId);
            }
          }
        } else {
          for (const change of snapshot.docChanges()) {
            const changedChat = change.doc.data() as Omit<ChatRow, "id" | "name" | "initials" | "color" | "time" | "preview">;
            const messageId = changedChat.lastMessageId;
            if (
              messageId &&
              !seenPingIdsRef.current.has(messageId) &&
              changedChat.lastMessageType === "ping"
            ) {
              seenPingIdsRef.current.add(messageId);
              if (changedChat.lastMessageSenderId !== user.uid) {
                receivePing(changedChat);
              }
            }
          }
        }
        initialSnapshot = false;
        rows.sort(
          (first, second) =>
            (second.updatedAt?.toMillis() ?? 0) - (first.updatedAt?.toMillis() ?? 0),
        );
        setChatRows(rows);
      },
      (error) => setChatError(friendlyError(error)),
    );
    const stopContacts = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const contacts = snapshot.docs
          .filter((profile) => profile.id !== user.uid)
          .map((profile) => {
            const profileEmail = String(profile.data().email ?? "");
            return {
              id: profile.id,
              name: profileEmail.split("@")[0] || "Pengguna",
              email: profileEmail,
              initials: profileEmail.slice(0, 2).toUpperCase() || "U",
              color: avatarColor(profileEmail),
              statusLabel: "Pengguna Ruang",
            };
          })
          .sort((first, second) => first.name.localeCompare(second.name));
        setContactList(contacts);
      },
      (error) => setChatError(friendlyError(error)),
    );
    return () => {
      stopChats();
      stopContacts();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !realtimeDb) {
      setPresence({});
      return;
    }
    const connectedRef = ref(realtimeDb, ".info/connected");
    const presenceRef = ref(realtimeDb, `presence/${user.uid}`);
    const stopConnection = onValue(
      connectedRef,
      (snapshot) => {
        if (snapshot.val() !== true) return;
        void onDisconnect(presenceRef)
          .set({ state: "offline", lastChanged: realtimeTimestamp() })
          .catch((error: unknown) => setChatError(friendlyError(error)));
        void set(presenceRef, {
          state: "online",
          lastChanged: realtimeTimestamp(),
        }).catch((error: unknown) => setChatError(friendlyError(error)));
      },
      (error) => setChatError(friendlyError(error)),
    );
    const stopPresence = onValue(
      ref(realtimeDb, "presence"),
      (snapshot) => setPresence((snapshot.val() as PresenceMap | null) ?? {}),
      (error) => setChatError(friendlyError(error)),
    );
    return () => {
      stopConnection();
      stopPresence();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !db) return;
    const firestore = db;
    const currentUser = user;
    const userRef = doc(firestore, "users", currentUser.uid);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    async function ensurePin() {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        const pin = Array.from(bytes, (byte) => alphabet[byte & 31]).join("");
        const assignedPin = await runTransaction(firestore, async (transaction) => {
          const profile = await transaction.get(userRef);
          const existingPin = profile.data()?.pin;
          if (typeof existingPin === "string") return existingPin;

          const claimRef = doc(firestore, "pins", pin);
          if ((await transaction.get(claimRef)).exists()) return null;

          transaction.set(
            userRef,
            {
              email: currentUser.email?.toLowerCase() ?? "",
              pin,
              createdAt: profile.data()?.createdAt ?? serverTimestamp(),
            },
            { merge: true },
          );
          transaction.set(claimRef, { uid: currentUser.uid, pin });
          return pin;
        });
        if (assignedPin) {
          setUserPin(assignedPin);
          return;
        }
      }
      throw new Error("Tidak berhasil membuat PIN unik. Coba muat ulang halaman.");
    }

    void ensurePin().catch((error: unknown) => setChatError(friendlyError(error)));
  }, [user]);

  useEffect(() => {
    if (!user || !db || !selectedChatId) {
      setMessages([]);
      return;
    }
    const messagesQuery = query(
      collection(db, "chats", selectedChatId, "messages"),
      orderBy("createdAt", "asc"),
      limitToLast(100),
    );
    return onSnapshot(
      messagesQuery,
      (snapshot) => {
        setMessages(
          snapshot.docs.map((messageDoc) => ({
            id: messageDoc.id,
            ...(messageDoc.data() as Omit<ChatMessage, "id">),
          })),
        );
      },
      (error) => setChatError(friendlyError(error)),
    );
  }, [selectedChatId, user]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return chatRows;
    return chatRows.filter((row) => row.name.toLowerCase().includes(query) || row.preview.toLowerCase().includes(query));
  }, [searchQuery]);
  const liveContacts = useMemo(
    () =>
      contactList.map((contact) => {
        const online = presence[contact.id]?.state === "online";
        return {
          ...contact,
          online,
          statusLabel: online ? "Aktif sekarang" : "Offline",
        };
      }),
    [contactList, presence],
  );
  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    return liveContacts.filter((contact) =>
      `${contact.name} ${contact.email ?? ""}`.toLowerCase().includes(query),
    );
  }, [liveContacts, contactSearch]);

  const selectedChat = chatRows.find((row) => row.id === selectedChatId) ?? null;
  const otherUserId = selectedChat?.members.find((member) => member !== user?.uid) ?? "";
  const otherEmail = selectedChat?.memberEmails[otherUserId] ?? selectedChat?.name ?? "";

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !db) return;
    setAuthError("");
    try {
      if (registerMode) {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim().toLowerCase(),
          password,
        );
        await setDoc(doc(db, "users", credential.user.uid), {
          email: credential.user.email?.toLowerCase(),
          createdAt: serverTimestamp(),
        });
      } else {
        await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      }
    } catch (error) {
      setAuthError(friendlyError(error));
    }
  }

  async function startChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !db) return;
    setChatError("");
    const identifier = contactIdentifier.trim();
    try {
      let targetId = "";
      let targetEmail = "";
      if (identifier.includes("@")) {
        const normalizedEmail = identifier.toLowerCase();
        if (normalizedEmail === user.email?.toLowerCase()) {
          setChatError("Masukkan email atau PIN pengguna lain, bukan milik Anda.");
          return;
        }
        const result = await getDocs(
          query(collection(db, "users"), where("email", "==", normalizedEmail), limit(1)),
        );
        const target = result.docs[0];
        if (!target) {
          setChatError("Pengguna belum terdaftar. Periksa email atau PIN BBM-nya.");
          return;
        }
        targetId = target.id;
        targetEmail = normalizedEmail;
      } else {
        const pin = identifier.toUpperCase();
        if (!/^[A-Z0-9]{8}$/.test(pin)) {
          setChatError("Masukkan email atau PIN BBM 8 karakter.");
          return;
        }
        const claim = await getDoc(doc(db, "pins", pin));
        const claimedUid = claim.data()?.uid;
        if (typeof claimedUid !== "string") {
          setChatError("PIN BBM tidak ditemukan. Periksa kembali PIN teman Anda.");
          return;
        }
        if (claimedUid === user.uid) {
          setChatError("Itu PIN BBM Anda sendiri. Masukkan PIN teman.");
          return;
        }
        const profile = await getDoc(doc(db, "users", claimedUid));
        const profileEmail = profile.data()?.email;
        if (typeof profileEmail !== "string") {
          setChatError("Profil pengguna dengan PIN tersebut tidak ditemukan.");
          return;
        }
        targetId = claimedUid;
        targetEmail = profileEmail;
      }

      const members = [user.uid, targetId].sort();
      const chatId = members.join("_");
      await setDoc(
        doc(db, "chats", chatId),
        {
          members,
          memberEmails: {
            [user.uid]: user.email?.toLowerCase() ?? "",
            [targetId]: targetEmail,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setSelectedChatId(chatId);
      setShowNewChat(false);
      setContactIdentifier("");
      setActiveTab("obrolan");
    } catch (error) {
      setChatError(friendlyError(error));
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !user || !db || !selectedChatId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const batch = writeBatch(db);
      const messageRef = doc(collection(db, "chats", selectedChatId, "messages"));
      batch.set(messageRef, { senderId: user.uid, text, createdAt: serverTimestamp() });
      batch.update(doc(db, "chats", selectedChatId), {
        lastMessage: text,
        lastMessageType: "text",
        lastMessageSenderId: user.uid,
        lastMessageId: messageRef.id,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      setDraft(text);
      setChatError(friendlyError(error));
    } finally {
      setSending(false);
    }
  }

  async function sendPing() {
    if (!user || !db || !selectedChatId || sending) return;
    setSending(true);
    setChatError("");
    try {
      const batch = writeBatch(db);
      const messageRef = doc(collection(db, "chats", selectedChatId, "messages"));
      batch.set(messageRef, {
        senderId: user.uid,
        text: "PING!!!",
        type: "ping",
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, "chats", selectedChatId), {
        lastMessage: "PING!!!",
        lastMessageType: "ping",
        lastMessageSenderId: user.uid,
        lastMessageId: messageRef.id,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      setChatError(friendlyError(error));
    } finally {
      setSending(false);
    }
  }

  function receivePing(
    chat: Pick<ChatRow, "lastMessageSenderId" | "memberEmails" | "lastMessageId">,
  ) {
    const senderId = chat.lastMessageSenderId;
    const sender = senderId ? chat.memberEmails[senderId] : undefined;
    if (pingSoundEnabledRef.current && audioContextRef.current) {
      playPingTone(audioContextRef.current);
    }
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
    setPingFlash(true);
    window.setTimeout(() => setPingFlash(false), 950);
    if (
      document.visibilityState === "hidden" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      const notification = new Notification("BBM Ping!", {
        body: `${sender?.split("@")[0] ?? "Teman"} mengirim Ping.`,
        tag: chat.lastMessageId,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  }

  async function togglePingSound() {
    if (pingSoundEnabled) {
      pingSoundEnabledRef.current = false;
      setPingSoundEnabled(false);
      return;
    }
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      await context.resume();
      pingSoundEnabledRef.current = true;
      setPingSoundEnabled(true);
      playPingTone(context);
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission().catch((error: unknown) =>
          setChatError(friendlyError(error)),
        );
      }
    } catch (error) {
      setChatError(friendlyError(error));
    }
  }

  async function copyPin() {
    if (!userPin) return;
    try {
      if (!navigator.clipboard) {
        throw new Error("Fitur salin tidak tersedia di browser ini.");
      }
      await navigator.clipboard.writeText(userPin);
      setPinCopied(true);
      window.setTimeout(() => setPinCopied(false), 1800);
    } catch (error) {
      setChatError(friendlyError(error));
    }
  }

  const renderContent = () => {
    switch (activeTab) {
      case "status":
        return (
          <div className="tab-page status-page">
            <header className="title-row status-header">
              <h1>Status</h1>
              <div className="header-tools">
                <button type="button" className="header-icon"                 aria-label="Cari kontak"
                onClick={() => setActiveTab("kontak")}>
                  <Search size={22} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  className="header-icon"
                  aria-label="Pengaturan status"
                  onClick={() => setActiveTab("pengaturan")}
                >
                  <Settings size={22} strokeWidth={2.2} />
                </button>
              </div>
            </header>

            <div className="status-card">
              <div className="avatar avatar-large avatar-pink">
                {(user?.email ?? "R").slice(0, 1).toUpperCase()}
              </div>
              <div className="status-copy">
                <div className="status-line">Status saya</div>
                <div className="status-sub">Berbagi status belum tersedia.</div>
              </div>
            </div>

            <div className="section-label">Kontak Ruang</div>
            <div className="status-list">
              {liveContacts.map((item) => (
                <div key={item.id} className="status-item">
                  <div className={`avatar status-avatar ${item.online ? "ring-primary" : "ring-muted"}`} style={{ background: item.color }}>{item.initials}</div>
                  <div className="status-person-details">
                    <div className="name-block">{item.name}</div>
                    <div className="detail-block">{item.statusLabel}</div>
                  </div>
                </div>
              ))}
              {liveContacts.length === 0 && (
                <p className="empty-state-copy">Belum ada pengguna lain yang terdaftar.</p>
              )}
            </div>
          </div>
        );

      case "panggilan":
        return (
          <div className="tab-page calls-page">
            <header className="title-row compact-title">
              <h1>Panggilan</h1>
              <button type="button" className="header-icon" aria-label="Cari kontak" onClick={() => setActiveTab("kontak")}>
                <Search size={22} strokeWidth={2.2} />
              </button>
            </header>

            <div className="call-chooser">
              <button type="button" className="call-option active" disabled title="Panggilan belum tersedia">
                <Video size={28} strokeWidth={2.2} />
                Buat tautan panggilan
              </button>
              <button type="button" className="call-option" disabled title="Panggilan belum tersedia">
                <PhoneCall size={28} strokeWidth={2.2} />
                Jadwalkan panggilan
              </button>
            </div>

            <div className="section-label small-uppercase">Kontak online</div>
            <div className="favorite-row">
              {liveContacts.filter((item) => item.online).slice(0, 8).map((item) => (
                <div key={item.id} className="favorite-card" style={{ background: item.color }}>
                  <div className="avatar favorite-avatar">{item.initials}</div>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>

            <div className="section-label small-uppercase">Semua kontak</div>
            <div className="call-list">
              {liveContacts.map((row) => (
                <div key={row.id} className="call-item">
                  <div className={`avatar status-avatar ${row.online ? "ring-primary" : "ring-muted"}`} style={{ background: row.color }}>{row.initials}</div>
                  <div className="call-copy">
                    <div className="name-block">{row.name}</div>
                    <div className="detail-block call-detail">
                      <span className={`direction ${row.online ? "incoming" : ""}`}>•</span>
                      {row.statusLabel}
                    </div>
                  </div>
                  <button type="button" className="call-bubble" aria-label={`Panggilan dengan ${row.name} belum tersedia`} disabled>
                    <Phone size={20} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
              {liveContacts.length === 0 && (
                <p className="empty-state-copy">Belum ada kontak untuk ditampilkan.</p>
              )}
            </div>

            <p className="empty-state-copy">Fitur panggilan belum terhubung.</p>
          </div>
        );

      case "kontak":
        return (
          <div className="tab-page contact-page">
            <header className="title-row compact-title">
              <h1>Kontak</h1>
              <button
                type="button"
                className="header-icon"
                aria-label="Tambah kontak"
                onClick={() => setShowNewChat(true)}
              >
                <Plus size={24} strokeWidth={2.2} />
              </button>
            </header>

            <label className="search-box soft-box" aria-label="Cari nama atau PIN">
              <Search size={22} strokeWidth={2.2} />
              <input
                type="text"
                placeholder="Cari nama atau email"
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
              />
            </label>

            <div className="pin-card">
              <div className="pin-card-text">
                <span>PIN saya</span>
                <strong>{userPin || "Membuat PIN..."}</strong>
              </div>
              <div className="pin-actions">
                <button type="button" aria-label="Salin PIN" onClick={() => void copyPin()}>
                  {pinCopied ? <Check size={20} strokeWidth={2.1} /> : <FileText size={20} strokeWidth={2.1} />}
                </button>
                <button
                  type="button"
                  aria-label="Mulai obrolan baru"
                  onClick={() => {
                    setContactIdentifier("");
                    setShowNewChat(true);
                  }}
                >
                  <Image size={20} strokeWidth={2.1} />
                </button>
              </div>
            </div>
            {chatError && <p className="inline-error"><CircleAlert size={15} />{chatError}</p>}

            <div className="feature-grid">
              <div className="feature-tile violet">
                <Users size={28} strokeWidth={2.2} />
                <span>Grup baru</span>
              </div>
              <div className="feature-tile blue">
                <Volume2 size={28} strokeWidth={2.2} />
                <span>Siaran</span>
              </div>
              <div className="feature-tile sky">
                <Plus size={28} strokeWidth={2.2} />
                <span>Tambah via PIN</span>
              </div>
              <div className="feature-tile green">
                <FileText size={28} strokeWidth={2.0} />
                <span>Pinjam QR</span>
              </div>
            </div>

            <div className="section-label section-inline">Semua kontak · {filteredContacts.length}</div>
            <div className="contact-list">
              {filteredContacts.map((item) => (
                <div key={item.id} className="contact-item">
                  <div className={`avatar status-avatar ${item.online ? "ring-primary" : "ring-muted"}`} style={{ background: item.color }}>{item.initials}</div>
                  <div className="contact-copy">
                    <div className="name-block">{item.name}</div>
                    <div className="detail-block">{item.statusLabel}</div>
                  </div>
                  <button
                    type="button"
                    className="contact-chat-bubble"
                    aria-label={`Chat dengan ${item.name}`}
                    onClick={() => {
                      setContactIdentifier(item.email ?? "");
                      setChatError("");
                      setShowNewChat(true);
                    }}
                  >
                    <MessageCircle size={18} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
              {filteredContacts.length === 0 && (
                <p className="empty-state-copy">
                  {contactSearch ? "Tidak ada kontak yang cocok." : "Belum ada kontak terdaftar."}
                </p>
              )}
            </div>
          </div>
        );

      case "pengaturan":
        return (
          <div className="tab-page settings-page">
            <header className="title-row compact-title">
              <h1>Pengaturan</h1>
            </header>

            <div className="profile-summary">
              <div className="avatar avatar-large avatar-pink">
                {(user?.email ?? "R").slice(0, 1).toUpperCase()}
              </div>
              <div className="profile-meta">
                <div className="profile-email">{user?.email}</div>
                <div className="profile-live">
                  <span className="dot-online" />
                  <span>PIN {userPin || "Membuat PIN..."}</span>
                </div>
              </div>
              <button type="button" className="profile-button" onClick={() => setShowNewChat(true)}>
                Chat baru
              </button>
            </div>

            <div className="section-label left-label">Akun</div>
            <div className="settings-list">
              {settingItems.slice(0, 3).map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="settings-row">
                    <span className="settings-icon" style={{ background: item.tint }}><Icon size={18} strokeWidth={2.2} /></span>
                    <span>{item.label}</span>
                    {item.extra ? <strong className="settings-extra">{item.extra}</strong> : <ChevronRight size={18} strokeWidth={2.3} className="meta-arrow" />}
                  </div>
                );
              })}
            </div>

            <div className="section-label left-label">Preferensi</div>
            <div className="settings-list">
              {settingItems.slice(3, 7).map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="settings-row">
                    <span className="settings-icon" style={{ background: item.tint }}><Icon size={18} strokeWidth={2.2} /></span>
                    <span>{item.label}</span>
                    {item.toggle ? <button type="button" className="toggle-switch" aria-label={item.label} /> : null}
                    {item.extra ? <strong className="settings-extra">{item.extra}</strong> : null}
                    {!item.toggle && !item.extra ? <ChevronRight size={18} strokeWidth={2.3} className="meta-arrow" /> : null}
                  </div>
                );
              })}
            </div>

            <div className="section-label left-label">Lainnya</div>
            <div className="settings-list">
              {settingItems.slice(7, 8).map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={`settings-row ${item.danger ? "danger-row" : ""}`}>
                    <span className="settings-icon" style={{ background: item.tint }}><Icon size={18} strokeWidth={2.2} /></span>
                    <span>{item.label}</span>
                    <ChevronRight size={18} strokeWidth={2.3} className="meta-arrow" />
                  </div>
                );
              })}
              <button
                type="button"
                className="settings-row danger-row"
                onClick={() => auth && void signOut(auth)}
              >
                <span className="settings-icon" style={{ background: "#f8dfe3" }}>
                  <PhoneCall size={18} strokeWidth={2.2} />
                </span>
                <span>Keluar · {user?.email}</span>
                <ChevronRight size={18} strokeWidth={2.3} className="meta-arrow" />
              </button>
            </div>
          </div>
        );

      case "obrolan":
      default:
        if (selectedChat) {
          return (
            <div className="tab-page chat-detail-page">
              <header className="chat-detail-header">
                <button type="button" className="back-button" aria-label="Kembali" onClick={() => setSelectedChatId(null)}>
                  <ChevronRight size={24} strokeWidth={2.5} className="rotate-180" />
                </button>
                <div className="avatar detail-avatar" style={{ background: selectedChat.color }}>{selectedChat.initials}</div>
                <div className="detail-title-wrap">
                  <h2>{selectedChat.name}</h2>
                  <span>{presence[otherUserId]?.state === "online" ? "Aktif sekarang" : "Offline"}</span>
                </div>
                <div className="detail-actions">
                  <button type="button" className="circle-action" aria-label="Panggilan video belum tersedia" disabled>
                    <PhoneCall size={22} strokeWidth={2.2} />
                  </button>
                  <button type="button" className="circle-action" aria-label="Telepon belum tersedia" disabled>
                    <Phone size={22} strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    className={`circle-action ${pingSoundEnabled ? "sound-active" : ""}`}
                    aria-label={pingSoundEnabled ? "Matikan suara Ping" : "Aktifkan suara Ping"}
                    onClick={() => void togglePingSound()}
                  >
                    {pingSoundEnabled
                      ? <Volume2 size={20} strokeWidth={2.2} />
                      : <VolumeX size={20} strokeWidth={2.2} />}
                  </button>
                </div>
              </header>

              <div className="chat-detail-body">
                <div className="date-pill">Pesan tersinkron real-time</div>
                {messages.length === 0 && (
                  <div className="empty-chat-state">
                    <MessageCircle size={28} />
                    <strong>Mulai obrolan dengan {otherEmail.split("@")[0]}</strong>
                    <span>Pesan akan muncul di sini setelah dikirim.</span>
                  </div>
                )}
                {messages.map((message) => {
                  const mine = message.senderId === user?.uid;
                  return (
                    <div className={`bubble-row ${mine ? "outgoing" : "incoming"}`} key={message.id}>
                      <div className={`bubble ${mine ? "blue" : "light"} ${message.type === "ping" ? "ping-bubble" : ""}`}>
                        {message.type === "ping" ? (
                          <span className="ping-message-content">◉&nbsp; BBM Ping!</span>
                        ) : message.text}
                      </div>
                      <div className="bubble-time">{formatTime(message.createdAt)}</div>
                    </div>
                  );
                })}
                <div ref={messageEndRef} />
              </div>

              {chatError && (
                <p className="inline-error chat-inline-error">
                  <CircleAlert size={15} /> {chatError}
                </p>
              )}
              <form className="composer-shell" onSubmit={sendMessage}>
                <button
                  type="button"
                  className="composer-add"
                  aria-label="Kirim BBM Ping"
                  onClick={() => void sendPing()}
                  disabled={sending}
                >
                  <Volume2 size={19} strokeWidth={2.2} />
                </button>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Tulis pesan..."
                  aria-label="Tulis pesan"
                  maxLength={4000}
                />
                <button type="button" className="composer-icon" aria-label="Emoji" disabled>
                  <Star size={20} strokeWidth={2.1} />
                </button>
                <button type="button" className="composer-icon" aria-label="Kamera"><Camera size={20} strokeWidth={2.2} /></button>
                <button
                  type="submit"
                  className="composer-send"
                  aria-label="Kirim"
                  disabled={!draft.trim() || sending}
                >
                  <MessageCircle size={20} strokeWidth={2.2} />
                </button>
              </form>
            </div>
          );
        }

        return (
          <div className="tab-page chat-page">
            <header className="title-row brand-row">
              <div className="brand-block">
                <div className="brand-oval">
                  <MessageCircle size={19} strokeWidth={2.6} />
                </div>
                <div className="brand-text">ruang<span>.</span></div>
              </div>
              <div className="header-tools">
                <button type="button" className="header-icon square-icon" aria-label="Pengaturan" onClick={() => setActiveTab("pengaturan")}>
                  <div className="mini-grid" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </button>
                <button
                  type="button"
                  className="header-avatar"
                  aria-label="Buka pengaturan akun"
                  onClick={() => setActiveTab("pengaturan")}
                >
                  {(user?.email ?? "R").slice(0, 1).toUpperCase()}
                </button>
              </div>
            </header>

            <div className="page-header">
              <h1>Obrolan</h1>
            </div>
            <div className="message-badge">
              {chatRows.length} percakapan · tersinkron real-time
            </div>
            {chatError && !selectedChat && (
              <p className="inline-error"><CircleAlert size={15} />{chatError}</p>
            )}

            <label className="search-box main-search" aria-label="Cari percakapan atau kontak">
              <Search size={22} strokeWidth={2.2} />
              <input
                type="text"
                placeholder="Cari percakapan atau kontak"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>

            <div className="contact-strip">
              {liveContacts.slice(0, 8).map((contact) => (
                <button
                  type="button"
                  key={contact.id}
                  className="contact-pill"
                  onClick={() => {
                    setContactIdentifier(contact.email ?? "");
                    setChatError("");
                    setShowNewChat(true);
                  }}
                >
                  <div className="avatar avatar-small contact-avatar" style={{ background: contact.color }}>
                    {contact.initials}
                    <span className="plus-mark">+</span>
                  </div>
                  <span>{contact.name}</span>
                </button>
              ))}
              {liveContacts.length === 0 && (
                <span className="contact-strip-empty">Kontak akan muncul di sini</span>
              )}
            </div>

            <div className="filter-row">
              <button type="button" className="filter active">Semua</button>
              <button type="button" className="filter" disabled title="Penanda pesan belum tersedia">Belum dibaca</button>
              <button type="button" className="filter" disabled title="Obrolan grup belum tersedia">Grup</button>
              <button type="button" className="filter" disabled title="Favorit belum tersedia">Favorit</button>
            </div>

            <div className="chat-list">
              {filteredChats.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`chat-row ${row.id === selectedChatId ? "selected" : ""}`}
                  onClick={() => setSelectedChatId(row.id)}
                >
                  <div className="avatar status-avatar ring-primary" style={{ background: row.color }}>{row.initials}</div>
                  <div className="chat-summary">
                    <div className="chat-head">
                      <div className="chat-name-wrap">
                        <span className="chat-name">{row.name}</span>
                        {row.pinned && <span className="pin-icon">↥</span>}
                      </div>
                      <time>{row.time}</time>
                    </div>
                    <div className="chat-meta">
                      <span>{row.preview}</span>
                      {row.unread ? <em>{row.unread}</em> : null}
                    </div>
                  </div>
                </button>
              ))}
              {filteredChats.length === 0 && (
                <div className="empty-chat-list">
                  <MessageCircle size={25} />
                  <strong>{searchQuery ? "Obrolan tidak ditemukan" : "Belum ada obrolan"}</strong>
                  <span>
                    {searchQuery
                      ? "Coba kata kunci lain."
                      : "Mulai chat dengan email atau PIN teman."}
                  </span>
                </div>
              )}
            </div>

            <div className="compose-box">
              <div className="avatar mini-avatar">
                {(user?.email ?? "R").slice(0, 1).toUpperCase()}
              </div>
              <div className="compose-copy">
                <div className="compose-name">{user?.email?.split("@")[0]}</div>
                <div className="compose-sub">PIN {userPin || "Membuat PIN..."}</div>
              </div>
              <button
                type="button"
                className="new-chat-btn"
                onClick={() => {
                  setChatError("");
                  setShowNewChat(true);
                }}
              >
                <MessageCircle size={22} strokeWidth={2.4} />
                <span>Chat baru</span>
              </button>
            </div>
          </div>
        );
    }
  };

  if (!firebaseReady) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <div className="brand-oval"><MessageCircle size={20} /></div>
          <p className="eyebrow">LANGKAH PERTAMA</p>
          <h1>Hubungkan Firebase</h1>
          <p className="setup-copy">
            Isi konfigurasi Firebase Web di <code>.env.local</code>, lalu muat ulang
            aplikasi. Jangan bagikan nilai private key atau kredensial server.
          </p>
          <div className="setup-steps">
            <span>Aktifkan Authentication Email/Password, Cloud Firestore, dan Realtime Database.</span>
            <span>Terapkan aturan keamanan dari <code>firestore.rules</code>.</span>
          </div>
        </section>
      </main>
    );
  }

  if (authLoading) {
    return <main className="loading-screen"><span className="loader" />Memuat Ruang...</main>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-lockup">
            <div className="brand-oval"><MessageCircle size={20} /></div>
            <span>ruang<span className="brand-dot">.</span></span>
          </div>
          <p className="eyebrow">{registerMode ? "MULAI TERHUBUNG" : "SENANG MELIHATMU"}</p>
          <h1>{registerMode ? "Buat akun baru" : "Percakapan dimulai di sini."}</h1>
          <p className="auth-subtitle">
            {registerMode ? "Daftar untuk mulai bertukar cerita." : "Masuk dan lanjutkan obrolan Anda."}
          </p>
          <form className="auth-form" onSubmit={handleAuth}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              autoComplete="email"
              type="email"
              placeholder="nama@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <label htmlFor="password">Kata sandi</label>
            <input
              id="password"
              autoComplete={registerMode ? "new-password" : "current-password"}
              type="password"
              placeholder="Minimal 6 karakter"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
            {authError && <p className="inline-error"><CircleAlert size={15} />{authError}</p>}
            <button className="primary-button auth-submit" type="submit">
              {registerMode ? "Buat akun" : "Masuk"} <ChevronRight size={17} />
            </button>
          </form>
          <p className="auth-toggle">
            {registerMode ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
            <button
              type="button"
              onClick={() => {
                setRegisterMode(!registerMode);
                setAuthError("");
              }}
            >
              {registerMode ? "Masuk" : "Daftar"}
            </button>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${pingFlash ? "ping-flash" : ""}`}>
      <div className="phone-screen">{renderContent()}</div>

      <nav className="bottom-nav" aria-label="Navigasi utama">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item ${activeTab === id ? "active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={22} strokeWidth={2.1} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {showNewChat && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowNewChat(false);
          }}
        >
          <section
            className="new-chat-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-chat-title"
          >
            <div className="modal-header">
              <div className="modal-label" id="new-chat-title">Pesan baru</div>
              <button
                type="button"
                className="close-icon"
                onClick={() => setShowNewChat(false)}
                aria-label="Tutup"
              >
                ×
              </button>
            </div>
            <p className="modal-copy">Cari teman yang sudah terdaftar menggunakan email atau PIN BBM.</p>
            <form onSubmit={startChat}>
              <label className="new-chat-field">
                <span>Email atau PIN BBM</span>
                <input
                  type="text"
                  placeholder="teman@email.com atau A1B2C3D4"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={320}
                  value={contactIdentifier}
                  onChange={(event) => setContactIdentifier(event.target.value)}
                  required
                />
              </label>
              {chatError && <p className="inline-error"><CircleAlert size={15} />{chatError}</p>}
              <button type="submit" className="primary-modal-action">
                Mulai obrolan <ChevronRight size={18} />
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
