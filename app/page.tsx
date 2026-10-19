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
  addDoc,
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
import {
  ArrowDownLeft,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  Copy,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Send,
  Smile,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { auth, db, firebaseReady, realtimeDb } from "@/lib/firebase";

type Chat = {
  id: string;
  members: string[];
  memberEmails: Record<string, string>;
  lastMessage?: string;
  updatedAt?: Timestamp | null;
};

type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt?: Timestamp | null;
};

type PresenceMap = Record<string, { state?: string }>;

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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<PresenceMap>({});
  const [draft, setDraft] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [userPin, setUserPin] = useState("");
  const [pinCopied, setPinCopied] = useState(false);
  const [pinError, setPinError] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);

  const selectedChat = chats.find((chat) => chat.id === selectedChatId);
  const otherUserId = selectedChat?.members.find((member) => member !== user?.uid);
  const otherEmail = otherUserId
    ? selectedChat?.memberEmails?.[otherUserId] ?? "Pengguna"
    : "";
  const filteredChats = useMemo(
    () =>
      chats.filter((chat) => {
        const otherId = chat.members.find((member) => member !== user?.uid) ?? "";
        return (chat.memberEmails?.[otherId] ?? "")
          .toLowerCase()
          .includes(search.toLowerCase());
      }),
    [chats, search, user?.uid],
  );

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
      setChats([]);
      setUserPin("");
      setPinError("");
      return;
    }
    setPinError("");
    const chatsQuery = query(
      collection(db, "chats"),
      where("members", "array-contains", user.uid),
    );
    return onSnapshot(
      chatsQuery,
      (snapshot) => {
        const nextChats = snapshot.docs.map((chatDoc) => ({
          id: chatDoc.id,
          ...(chatDoc.data() as Omit<Chat, "id">),
        }));
        nextChats.sort(
          (first, second) =>
            (second.updatedAt?.toMillis() ?? 0) -
            (first.updatedAt?.toMillis() ?? 0),
        );
        setChats(nextChats);
      },
      (error) => setChatError(friendlyError(error)),
    );
  }, [user]);

  useEffect(() => {
    if (!user || !db) return;

    const currentUser = user;
    const firestore = db;
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
          const claim = await transaction.get(claimRef);
          if (claim.exists()) return null;

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

    void ensurePin().catch((error: unknown) => {
      setPinError(friendlyError(error));
    });
  }, [user]);

  useEffect(() => {
    if (!user || !realtimeDb) {
      setPresence({});
      return;
    }
    const connectedRef = ref(realtimeDb, ".info/connected");
    const presenceRef = ref(realtimeDb, `presence/${user.uid}`);
    const stopConnection = onValue(connectedRef, (snapshot) => {
      if (snapshot.val() !== true) return;
      void onDisconnect(presenceRef)
        .set({ state: "offline", lastChanged: realtimeTimestamp() })
        .catch((error: unknown) => setChatError(friendlyError(error)));
      void set(presenceRef, {
        state: "online",
        lastChanged: realtimeTimestamp(),
      }).catch((error: unknown) => setChatError(friendlyError(error)));
    });
    const stopPresence = onValue(ref(realtimeDb, "presence"), (snapshot) => {
      setPresence((snapshot.val() as PresenceMap | null) ?? {});
    });
    return () => {
      stopConnection();
      stopPresence();
    };
  }, [user]);

  useEffect(() => {
    if (!selectedChatId || !db || !user) {
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
    const identifier = contactEmail.trim();
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
          query(
            collection(db, "users"),
            where("email", "==", normalizedEmail),
            limit(1),
          ),
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
      const chatRef = doc(db, "chats", chatId);
      await setDoc(
        chatRef,
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
      setMobileChatOpen(true);
      setShowNewChat(false);
      setContactEmail("");
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
      batch.set(messageRef, {
        senderId: user.uid,
        text,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, "chats", selectedChatId), {
        lastMessage: text,
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

  async function copyPin() {
    if (!userPin) return;
    try {
      await navigator.clipboard.writeText(userPin);
      setPinCopied(true);
      window.setTimeout(() => setPinCopied(false), 1600);
    } catch {
      setPinError("PIN tidak bisa disalin. Silakan salin PIN secara manual.");
    }
  }

  if (!firebaseReady) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark"><MessageCircle size={25} /></div>
          <p className="eyebrow">LANGKAH PERTAMA</p>
          <h1>Hubungkan Firebase</h1>
          <p className="setup-copy">
            Buat project Firebase, aktifkan Authentication (Email/Password),
            Cloud Firestore, dan Realtime Database. Salin konfigurasi web ke
            file <code>.env.local</code>.
          </p>
          <div className="setup-steps">
            <span><b>1</b> Salin <code>.env.example</code> menjadi <code>.env.local</code></span>
            <span><b>2</b> Isi variabel Firebase dari Project settings</span>
            <span><b>3</b> Terapkan <code>firestore.rules</code> dan <code>database.rules.json</code></span>
            <span><b>4</b> Jalankan <code>npm run dev</code></span>
          </div>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return <main className="loading-screen"><span className="loader" />Memuat Ruang...</main>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <div className="auth-decoration decoration-one" />
        <div className="auth-decoration decoration-two" />
        <section className="auth-card">
          <div className="brand-lockup">
            <div className="brand-mark"><MessageCircle size={24} /></div>
            <span>ruang<span className="brand-dot">.</span></span>
          </div>
          <p className="eyebrow">{registerMode ? "MULAI TERHUBUNG" : "SENANG MELIHATMU"}</p>
          <h1>{registerMode ? "Buat akun baru" : "Percakapan dimulai di sini."}</h1>
          <p className="auth-subtitle">
            {registerMode
              ? "Daftar untuk mulai bertukar cerita."
              : "Masuk dan lanjutkan obrolan Anda."}
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
              {registerMode ? "Buat akun" : "Masuk"} <ArrowDownLeft size={17} />
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
          <p className="auth-footnote"><Wifi size={13} /> Percakapan tersinkron secara real-time</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileChatOpen ? "sidebar-hidden-mobile" : ""}`}>
        <header className="sidebar-header">
          <div className="brand-lockup compact">
            <div className="brand-mark"><MessageCircle size={20} /></div>
            <span>ruang<span className="brand-dot">.</span></span>
          </div>
          <div className="header-actions">
            <button className="icon-button" title="Grup baru" aria-label="Grup baru" disabled>
              <Users size={18} />
            </button>
            <button
              className="icon-button"
              title="Percakapan baru"
              aria-label="Percakapan baru"
              onClick={() => {
                setShowNewChat(true);
                setChatError("");
              }}
            >
              <Plus size={20} />
            </button>
            <button
              className="icon-button"
              title="Keluar"
              aria-label="Keluar"
              onClick={() => auth && void signOut(auth)}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <button
          className="current-user profile-trigger"
          type="button"
          onClick={() => setShowProfile(true)}
          aria-haspopup="dialog"
          aria-label="Lihat profil dan PIN BBM"
        >
          <div className="avatar self-avatar" style={{ background: avatarColor(user.email ?? user.uid) }}>
            {(user.email ?? "S").slice(0, 1).toUpperCase()}
            <i className="online-dot" />
          </div>
          <div className="current-user-info">
            <strong>{user.email}</strong>
            <span><i className="online-dot small" /> Aktif sekarang</span>
            <div className="my-pin">
              <span>PIN</span>
              <strong>{userPin || (pinError ? "GAGAL" : "DIBUAT...")}</strong>
              <span className="profile-hint">LIHAT PROFIL</span>
            </div>
            {pinError && <span className="pin-inline-error">{pinError}</span>}
          </div>
          <MoreVertical size={17} className="muted-icon" />
        </button>
        <div className="search-wrap">
          <Search size={17} />
          <input
            aria-label="Cari percakapan"
            placeholder="Cari percakapan"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && <button onClick={() => setSearch("")} aria-label="Hapus pencarian"><X size={15} /></button>}
        </div>
        <div className="conversation-heading">
          <span>PESANAN</span><span>{chats.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="conversation-list">
          {filteredChats.length === 0 ? (
            <div className="empty-conversations">
              <div className="empty-icon"><MessageCircle size={20} /></div>
              <strong>{search ? "Tidak ditemukan" : "Belum ada obrolan"}</strong>
              <span>{search ? "Coba kata kunci lain." : "Mulai percakapan dengan teman."}</span>
              {!search && <button onClick={() => setShowNewChat(true)}><Plus size={15} /> Chat baru</button>}
            </div>
          ) : (
            filteredChats.map((chat) => {
              const otherId = chat.members.find((member) => member !== user.uid) ?? "";
              const contact = chat.memberEmails?.[otherId] ?? "Pengguna";
              const isOnline = presence[otherId]?.state === "online";
              return (
                <button
                  className={`conversation-item ${selectedChatId === chat.id ? "conversation-active" : ""}`}
                  key={chat.id}
                  onClick={() => {
                    setSelectedChatId(chat.id);
                    setMobileChatOpen(true);
                  }}
                >
                  <div className="avatar conversation-avatar" style={{ background: avatarColor(contact) }}>
                    {contact.slice(0, 1).toUpperCase()}
                    {isOnline && <i className="online-dot" />}
                  </div>
                  <div className="conversation-content">
                    <div className="conversation-topline">
                      <strong>{contact.split("@")[0]}</strong>
                      <time>{formatTime(chat.updatedAt)}</time>
                    </div>
                    <div className="conversation-bottomline">
                      <span>{chat.lastMessage || "Mulai percakapan baru"}</span>
                      {chat.lastMessage && <CheckCheck size={15} className="read-icon" />}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <footer className="sidebar-footer">
          <span className="secure-dot" /> Percakapan Anda tersinkron dengan aman
        </footer>
      </aside>

      <section className={`chat-panel ${mobileChatOpen ? "chat-panel-mobile-open" : ""}`}>
        {selectedChat ? (
          <>
            <header className="chat-header">
              <button className="icon-button back-button" onClick={() => setMobileChatOpen(false)} aria-label="Kembali">
                <ArrowLeft size={19} />
              </button>
              <div className="avatar chat-avatar" style={{ background: avatarColor(otherEmail) }}>
                {otherEmail.slice(0, 1).toUpperCase()}
                {presence[otherUserId ?? ""]?.state === "online" && <i className="online-dot" />}
              </div>
              <div className="chat-contact">
                <strong>{otherEmail.split("@")[0]}</strong>
                <span>{presence[otherUserId ?? ""]?.state === "online" ? "online" : otherEmail}</span>
              </div>
              <div className="chat-header-actions">
                <span className="encrypted-label"><Wifi size={14} /> REAL-TIME</span>
                <button className="icon-button" title="Opsi lainnya" aria-label="Opsi lainnya"><MoreVertical size={19} /></button>
              </div>
            </header>
            <div className="message-area">
              <div className="date-divider"><span>AWAL PERCAKAPAN</span></div>
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-empty-icon"><MessageCircle size={24} /></div>
                  <strong>Sapa {otherEmail.split("@")[0]}</strong>
                  <span>Kirim pesan pertama untuk memulai obrolan.</span>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((message, index) => {
                    const mine = message.senderId === user.uid;
                    const previous = messages[index - 1];
                    const showSender = !mine && previous?.senderId !== message.senderId;
                    return (
                      <div
                        className={`message-row ${mine ? "message-row-mine" : ""}`}
                        key={message.id}
                      >
                        {!mine && <div className="message-avatar-space">{showSender && <span style={{ background: avatarColor(otherEmail) }}>{otherEmail.slice(0, 1).toUpperCase()}</span>}</div>}
                        <div className={`message-bubble ${mine ? "message-mine" : "message-theirs"}`}>
                          {showSender && <span className="message-sender">{otherEmail.split("@")[0]}</span>}
                          <p>{message.text}</p>
                          <div className="message-meta">
                            <time>{formatTime(message.createdAt)}</time>
                            {mine && <Check size={13} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messageEndRef} />
                </div>
              )}
              <div className="message-security"><span /> PESANAN TERSINKRON REAL-TIME</div>
            </div>
            {chatError && <div className="chat-alert"><CircleAlert size={15} />{chatError}<button onClick={() => setChatError("")} aria-label="Tutup"><X size={15} /></button></div>}
            <form className="composer" onSubmit={sendMessage}>
              <button type="button" className="icon-button composer-tool" aria-label="Emoji" title="Emoji (segera hadir)" disabled><Smile size={21} /></button>
              <button type="button" className="icon-button composer-tool attach-button" aria-label="Lampiran" title="Lampiran (segera hadir)" disabled><Paperclip size={19} /></button>
              <input
                aria-label="Tulis pesan"
                placeholder="Tulis pesan..."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={4000}
              />
              <button className="send-button" type="submit" disabled={!draft.trim() || sending} aria-label="Kirim pesan">
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div className="welcome-panel">
            <div className="welcome-art">
              <div className="art-circle circle-large" />
              <div className="art-circle circle-small" />
              <div className="art-message"><MessageCircle size={31} /></div>
              <div className="art-sparkle sparkle-one">✳</div>
              <div className="art-sparkle sparkle-two">✦</div>
            </div>
            <p className="eyebrow">RUANG UNTUK BERCERITA</p>
            <h1>Obrolan yang terasa dekat.</h1>
            <p>Pilih percakapan di samping atau mulai obrolan baru. Semua pesan tersinkron secara real-time.</p>
            <button className="primary-button welcome-button" onClick={() => setShowNewChat(true)}>
              <Plus size={17} /> Mulai percakapan
            </button>
            <div className="welcome-note"><Wifi size={14} /> Terhubung dengan Firebase</div>
          </div>
        )}
      </section>

      {showProfile && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowProfile(false);
          }}
        >
          <section
            className="new-chat-modal profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
          >
            <header>
              <div className="modal-icon"><MessageCircle size={20} /></div>
              <button className="icon-button" onClick={() => setShowProfile(false)} aria-label="Tutup profil"><X size={19} /></button>
            </header>
            <p className="eyebrow">PROFIL BBM</p>
            <h2 id="profile-title">Profil Anda</h2>
            <p className="profile-email">{user.email}</p>
            <div className="profile-pin-card">
              <span>PIN BBM ANDA</span>
              <strong>{userPin || (pinError ? "PIN BELUM TERSEDIA" : "SEDANG MEMBUAT PIN...")}</strong>
              <p>Bagikan PIN ini kepada teman agar mereka dapat mengundang Anda mengobrol.</p>
              {pinError && <p className="profile-pin-error">{pinError}</p>}
              <button className="primary-button copy-pin-button" type="button" onClick={() => void copyPin()} disabled={!userPin}>
                {pinCopied ? <Check size={16} /> : <Copy size={16} />}
                {pinCopied ? "PIN TERSALIN" : "SALIN PIN"}
              </button>
            </div>
            <button className="profile-new-chat" type="button" onClick={() => {
              setShowProfile(false);
              setShowNewChat(true);
            }}>
              <Plus size={16} /> Mulai chat dengan PIN teman
            </button>
          </section>
        </div>
      )}

      {showNewChat && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowNewChat(false);
        }}>
          <section className="new-chat-modal" aria-labelledby="new-chat-title">
            <header>
              <div className="modal-icon"><MessageCircle size={20} /></div>
              <button className="icon-button" onClick={() => setShowNewChat(false)} aria-label="Tutup"><X size={19} /></button>
            </header>
            <p className="eyebrow">PERCAKAPAN BARU</p>
            <h2 id="new-chat-title">Siapa yang ingin Anda sapa?</h2>
            <p className="modal-copy">Masukkan email yang digunakan teman Anda saat mendaftar.</p>
            <form onSubmit={startChat}>
              <label htmlFor="contact-email">Email atau PIN BBM teman</label>
              <input
                id="contact-email"
                autoFocus
                type="text"
                placeholder="teman@email.com atau A1B2C3D4"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={320}
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                required
              />
              {chatError && <p className="inline-error"><CircleAlert size={15} />{chatError}</p>}
              <button className="primary-button modal-submit" type="submit">Mulai chat <ArrowDownLeft size={17} /></button>
            </form>
            <div className="modal-footnote"><Wifi size={13} /> Hanya pengguna terdaftar yang bisa dihubungi</div>
          </section>
        </div>
      )}
    </main>
  );
}
