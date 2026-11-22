import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://ushkxkocqgofhozkpctq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TWdxStrX_8DsS7KsUm_41g_MVp0dhq3";
const FOUNDER_ID = "864270a0-ca72-455b-aeac-95e052cc4b2b";
const GENERAL_ROOM_ID = "00000000-0000-4000-8000-000000000001";
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } }
});

const $ = (id) => document.getElementById(id);
const state = {
  user: null, me: null, rooms: [], conversations: [], chats: [], active: null,
  messages: [], members: [], filter: "all", channel: null, pollTimer: null,
  deferredInstall: null, reportTarget: null, mediaRecorder: null, audioChunks: [],
  seenMessages: new Set(), lastNotificationAt: 0
};
const esc = (value = "") => String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
const isFounder = () => state.me?.role === "founder" || state.user?.id === FOUNDER_ID;
const avatarOf = (url) => url || "./icon.svg";
const toast = (message) => {
  const node = document.createElement("div");
  node.className = "toast"; node.textContent = message; $("toast-region").append(node);
  setTimeout(() => node.remove(), 3800);
};
const setConnection = (text) => { $("connection-state").textContent = text; };
const fmtTime = (value) => value ? new Intl.DateTimeFormat("ar-SA",{hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "";
const fmtDate = (value) => value ? new Intl.DateTimeFormat("ar-SA",{day:"numeric",month:"short"}).format(new Date(value)) : "";
const activeKey = (item) => item.kind === "room" ? `room:${item.id}` : `conversation:${item.id}`;
const isMine = (message) => message.sender_id === state.user?.id;
const showView = (viewId) => {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active-view", v.id === viewId));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === viewId));
  if (viewId === "members-view") loadMembers($("member-search-input").value);
};
const uploadMedia = async (file, folder) => {
  if (!file) throw new Error("لم يتم اختيار ملف.");
  if (file.size > 20 * 1024 * 1024) throw new Error("حجم الملف يتجاوز 20MB.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${state.user.id}/${folder}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { error } = await db.storage.from("chat-media").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = db.storage.from("chat-media").getPublicUrl(path);
  return data.publicUrl;
};
const profileName = (profile) => profile?.display_name || profile?.username || "عضو NOVA";
const chatLabel = (item) => item.kind === "room" ? item.name : (item.type === "group" ? item.name : item.other_profile?.display_name || item.other_profile?.username || "محادثة خاصة");
const chatAvatar = (item) => item.kind === "room" ? item.avatar_url : (item.type === "group" ? item.avatar_url : item.other_profile?.avatar_url);

async function loadProfile() {
  const { data, error } = await db.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const username = (state.user.email || "nova-user").split("@")[0].replace(/[^a-zA-Z0-9_]/g,"").slice(0,24) || "nova-user";
    const { data: created, error: createError } = await db.from("profiles").insert({
      id: state.user.id, username: `${username}_${state.user.id.slice(0,5)}`,
      display_name: state.user.user_metadata?.display_name || username
    }).select().single();
    if (createError) throw createError;
    state.me = created;
  } else state.me = data;
  $("my-name").textContent = profileName(state.me);
  $("my-handle").textContent = `@${state.me.username || "member"}`;
  $("my-avatar").src = avatarOf(state.me.avatar_url);
  $("settings-avatar").src = avatarOf(state.me.avatar_url);
  $("profile-name-input").value = state.me.display_name || "";
  $("account-email").textContent = state.user.email || "";
  $("role-chip").classList.toggle("hidden", !isFounder());
  $("founder-tools").classList.toggle("hidden", !isFounder());
}
async function loadRooms() {
  const { data, error } = await db.from("rooms").select("*").eq("is_public", true).order("created_at");
  if (error) throw error;
  state.rooms = data || [];
  if (!state.rooms.some(r => r.id === GENERAL_ROOM_ID)) {
    state.rooms.unshift({ id: GENERAL_ROOM_ID, name: "الشات العام", is_public: true, description: "المساحة العامة" });
  }
}
async function loadConversations() {
  const { data: memberships, error: memberError } = await db.from("conversation_members").select("conversation_id").eq("user_id", state.user.id);
  if (memberError && memberError.code !== "42P01") throw memberError;
  const ids = (memberships || []).map(x => x.conversation_id);
  let query = db.from("conversations").select("*").order("updated_at", {ascending:false});
  if (!isFounder()) {
    if (!ids.length) { state.conversations = []; return; }
    query = query.in("id", ids);
  } else if (ids.length) {
    // Founder can inspect every group; direct conversations remain membership-only.
    query = query.or(`type.eq.group,id.in.(${ids.join(",")})`);
  } else {
    query = query.eq("type", "group");
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const directIds = rows.filter(c => c.type === "direct").map(c => c.id);
  let profilesByConversation = {};
  if (directIds.length) {
    const { data: cm } = await db.from("conversation_members").select("conversation_id,user_id").in("conversation_id", directIds);
    const otherIds = [...new Set((cm || []).filter(x => x.user_id !== state.user.id).map(x => x.user_id))];
    if (otherIds.length) {
      const { data: people } = await db.from("profiles").select("id,username,display_name,avatar_url").in("id", otherIds);
      const peopleMap = Object.fromEntries((people || []).map(p => [p.id,p]));
      for (const c of directIds) {
        const other = (cm || []).find(x => x.conversation_id === c && x.user_id !== state.user.id);
        profilesByConversation[c] = other ? peopleMap[other.user_id] : null;
      }
    }
  }
  state.conversations = rows.map(c => ({...c, other_profile: profilesByConversation[c.id]}));
}
async function loadChatPreviews() {
  const roomItems = state.rooms.map(r => ({...r, kind:"room"}));
  const conversationItems = state.conversations.map(c => ({...c, kind:"conversation"}));
  state.chats = [...roomItems, ...conversationItems];
  const ids = state.chats.map(activeKey);
  const latest = new Map();
  for (const item of state.chats) {
    const col = item.kind === "room" ? "room_id" : "conversation_id";
    const { data } = await db.from("messages").select("id,room_id,conversation_id,sender_id,content,media_type,created_at,deleted_at")
      .eq(col,item.id).is("deleted_at",null).order("created_at",{ascending:false}).limit(1);
    if (data?.[0]) latest.set(activeKey(item), data[0]);
  }
  state.chats = state.chats.map(item => ({...item, last:latest.get(activeKey(item)) || null}));
  renderChatList();
}
function renderChatList() {
  const q = $("global-search").value.trim().toLowerCase();
  const filtered = state.chats.filter(item => {
    const direct = item.kind === "conversation" && item.type === "direct";
    if (state.filter === "direct" && !direct) return false;
    if (state.filter === "groups" && direct) return false;
    const hay = `${chatLabel(item)} ${item.last?.content || ""}`.toLowerCase();
    return !q || hay.includes(q);
  }).sort((a,b) => new Date(b.last?.created_at || b.updated_at || b.created_at || 0) - new Date(a.last?.created_at || a.updated_at || a.created_at || 0));
  $("chat-list").innerHTML = filtered.map(item => {
    const last = item.last;
    const prefix = last ? (last.sender_id === state.user.id ? "أنت: " : "") : "";
    const preview = last ? (last.deleted_at ? "تم حذف الرسالة" : last.media_type === "image" ? "📷 صورة" : last.media_type === "audio" ? "🎙 رسالة صوتية" : last.content || "") : "ابدأ المحادثة";
    const unread = Number(item.unread_count || 0);
    return `<article class="chat-item ${state.active && activeKey(state.active) === activeKey(item) ? "active" : ""}" data-chat="${esc(activeKey(item))}">
      <img class="avatar" src="${esc(avatarOf(chatAvatar(item)))}" alt="">
      <div class="chat-meta"><div class="chat-top"><b>${esc(chatLabel(item))}</b><time>${fmtTime(last?.created_at)}</time></div>
      <div class="chat-bottom"><p>${esc(prefix + preview)}</p>${unread ? `<span class="unread">${unread>99?"99+":unread}</span>` : ""}</div></div></article>`;
  }).join("") || `<p class="muted tiny" style="padding:20px;text-align:center">لا توجد محادثات مطابقة.</p>`;
  $("chat-list").querySelectorAll("[data-chat]").forEach(node => node.addEventListener("click", () => {
    const item = state.chats.find(x => activeKey(x) === node.dataset.chat);
    if (item) openChat(item);
  }));
}
async function openChat(item) {
  state.active = item;
  $("welcome-panel").classList.add("hidden");
  $("conversation-panel").classList.remove("hidden");
  $("active-title").textContent = chatLabel(item);
  $("active-avatar").src = avatarOf(chatAvatar(item));
  $("active-subtitle").textContent = item.kind === "room" ? "مساحة عامة" : item.type === "group" ? "مجموعة خاصة" : "محادثة خاصة";
  renderChatList();
  await loadMessages();
  if (window.innerWidth <= 680) showView("chats-view");
}
async function loadMessages() {
  if (!state.active) return;
  const col = state.active.kind === "room" ? "room_id" : "conversation_id";
  const { data, error } = await db.from("messages").select("*,sender:profiles!messages_sender_id_fkey(id,username,display_name,avatar_url)")
    .eq(col,state.active.id).order("created_at",{ascending:true}).limit(300);
  if (error) { toast(error.message); return; }
  state.messages = data || [];
  renderMessages();
  const unreadIds = state.messages.filter(m => !isMine(m) && !m.read_at).map(m => m.id);
  if (unreadIds.length) db.from("messages").update({read_at:new Date().toISOString()}).in("id",unreadIds).then(()=>{});
}
function renderMessages() {
  const box = $("message-list");
  box.innerHTML = state.messages.map(m => {
    const mine = isMine(m);
    const sender = profileName(m.sender);
    let content = "";
    if (m.deleted_at) content = `<i class="muted">تم حذف هذه الرسالة</i>`;
    else if (m.media_type === "image" && m.media_url) content = `<img class="message-media" src="${esc(m.media_url)}" alt="صورة مرسلة" loading="lazy">`;
    else if (m.media_type === "audio" && m.media_url) content = `<audio class="message-audio" controls preload="metadata" src="${esc(m.media_url)}"></audio>`;
    else content = `<div class="message-text">${esc(m.content || "")}</div>`;
    return `<div class="message-row ${mine?"mine":"theirs"}" data-message="${esc(m.id)}">
      <div class="message-bubble">${!mine && state.active?.type !== "direct" ? `<div class="message-sender">${esc(sender)}</div>` : ""}${content}<div class="message-time">${fmtTime(m.created_at)}${mine?" · ✓":""}</div></div>
      <div class="message-tools"><button data-report-message="${esc(m.id)}" title="إبلاغ">⚑</button>${mine || isFounder() ? `<button data-delete-message="${esc(m.id)}" title="حذف">حذف</button>` : ""}</div></div>`;
  }).join("");
  box.querySelectorAll("[data-report-message]").forEach(b => b.addEventListener("click",()=>openReport({message_id:b.dataset.reportMessage})));
  box.querySelectorAll("[data-delete-message]").forEach(b => b.addEventListener("click",()=>deleteMessage(b.dataset.deleteMessage)));
  box.scrollTop = box.scrollHeight;
}
async function sendMessage({content="",media_url=null,media_type="text"}={}) {
  if (!state.active) return toast("اختر محادثة أولاً.");
  if (!content.trim() && !media_url) return;
  const payload = {sender_id:state.user.id,content:content.trim() || null,media_url,media_type};
  payload[state.active.kind === "room" ? "room_id" : "conversation_id"] = state.active.id;
  const { data, error } = await db.from("messages").insert(payload).select("*,sender:profiles!messages_sender_id_fkey(id,username,display_name,avatar_url)").single();
  if (error) { toast(error.message); return; }
  upsertMessage(data);
  loadChatPreviews();
}
function upsertMessage(message) {
  if (!message?.id) return;
  const i = state.messages.findIndex(m=>m.id===message.id);
  if (i >= 0) state.messages[i] = {...state.messages[i],...message}; else state.messages.push(message);
  state.messages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  renderMessages();
}
async function deleteMessage(id) {
  const { error } = await db.from("messages").update({deleted_at:new Date().toISOString(),content:null,media_url:null}).eq("id",id);
  if (error) return toast(error.message);
  toast("تم حذف الرسالة."); await loadMessages(); await loadChatPreviews();
}
async function loadMembers(query="") {
  let req = db.from("profiles").select("id,username,display_name,avatar_url,role").neq("id",state.user.id).order("display_name").limit(80);
  if (query.trim()) req = req.or(`display_name.ilike.%${query.trim()}%,username.ilike.%${query.trim()}%`);
  const { data, error } = await req;
  if (error) { toast(error.message); return; }
  state.members = data || [];
  $("members-list").innerHTML = state.members.map(p=>`<article class="member-card"><img class="avatar" src="${esc(avatarOf(p.avatar_url))}" alt=""><div class="member-info"><b>${esc(profileName(p))}</b><small>@${esc(p.username||"member")}</small></div><button data-start-chat="${esc(p.id)}">مراسلة</button></article>`).join("") || `<p class="muted">لا يوجد أعضاء مطابقون.</p>`;
  $("members-list").querySelectorAll("[data-start-chat]").forEach(b=>b.addEventListener("click",()=>startDirect(b.dataset.startChat)));
}
async function startDirect(userId) {
  const { data, error } = await db.rpc("start_direct_conversation",{other_user_id:userId});
  if (error) return toast(error.message);
  await loadConversations(); await loadChatPreviews();
  const item = state.chats.find(x=>x.kind==="conversation" && x.id===data);
  if (item) { showView("chats-view"); await openChat(item); }
}
async function createGroup(name) {
  const { data, error } = await db.rpc("create_private_group",{group_name:name});
  if (error) return toast(error.message);
  await loadConversations(); await loadChatPreviews();
  const item = state.chats.find(x=>x.id===data && x.kind==="conversation");
  if (item) await openChat(item);
  toast("تم إنشاء المجموعة الخاصة.");
}
function openReport(target) {
  state.reportTarget = target;
  $("report-reason").value = "";
  $("report-dialog").showModal();
}
async function submitReport(event) {
  event.preventDefault();
  const reason = $("report-reason").value.trim();
  if (!reason || !state.reportTarget) return;
  const payload = {reporter_id:state.user.id,reason,status:"open",...state.reportTarget};
  if (state.active && !payload.conversation_id && !payload.room_id && !payload.message_id) {
    payload[state.active.kind === "room" ? "room_id" : "conversation_id"] = state.active.id;
  }
  const {error} = await db.from("reports").insert(payload);
  if (error) return toast(error.message);
  $("report-dialog").close(); toast("تم إرسال البلاغ للمراجعة."); state.reportTarget=null;
}
async function loadReports() {
  if (!isFounder()) return;
  const {data,error}=await db.rpc("founder_list_reports");
  if(error) return toast(error.message);
  $("reports-list").innerHTML=(data||[]).map(r=>`<article class="report-item"><b>بلاغ #${esc(r.id.slice(0,8))}</b><p>${esc(r.reason)}<br>الحالة: ${esc(r.status)}<br>المحتوى: ${esc(r.reported_content||"غير متاح")}</p><div class="report-actions"><button data-resolve="${esc(r.id)}">إغلاق البلاغ</button>${r.message_id?`<button data-report-delete="${esc(r.id)}">حذف الرسالة</button>`:""}<button data-mute="${esc(r.target_user_id || "")}">كتم المبلّغ عنه</button><button data-unmute="${esc(r.target_user_id || "")}">فك الكتم</button><button data-ban="${esc(r.target_user_id || "")}">حظر المبلّغ عنه</button><button data-unban="${esc(r.target_user_id || "")}">فك الحظر</button></div></article>`).join("") || `<p class="muted tiny">لا توجد بلاغات مفتوحة.</p>`;
  $("reports-list").querySelectorAll("[data-resolve]").forEach(b=>b.addEventListener("click",()=>moderateReport(b.dataset.resolve,"resolve")));
  $("reports-list").querySelectorAll("[data-report-delete]").forEach(b=>b.addEventListener("click",()=>moderateReport(b.dataset.reportDelete,"delete")));
  $("reports-list").querySelectorAll("[data-mute]").forEach(b=>b.addEventListener("click",()=>moderateUser(b.dataset.mute,"mute")));
  $("reports-list").querySelectorAll("[data-ban]").forEach(b=>b.addEventListener("click",()=>moderateUser(b.dataset.ban,"ban")));
  $("reports-list").querySelectorAll("[data-unmute]").forEach(b=>b.addEventListener("click",()=>moderateUser(b.dataset.unmute,"unmute")));
  $("reports-list").querySelectorAll("[data-unban]").forEach(b=>b.addEventListener("click",()=>moderateUser(b.dataset.unban,"unban")));
}
async function moderateReport(reportId,action) {
  if(action==="delete") {
    const {error}=await db.rpc("founder_delete_reported_message",{report_id:reportId});
    if(error) return toast(error.message);
  }
  const {error}=await db.rpc("founder_close_report",{report_id:reportId});
  if(error) return toast(error.message);
  toast("تم تنفيذ الإجراء."); loadReports();
}
async function moderateUser(userId,kind) {
  if(!userId) return toast("تعذر تحديد صاحب المحتوى في هذا البلاغ.");
  let amount=0, unit="hours";
  if(kind==="mute" || kind==="ban") {
    const amountRaw=prompt("أدخل المدة كرقم (0 = دائم):","1");
    if(amountRaw===null) return;
    amount=Number(amountRaw);
    if(!Number.isFinite(amount)||amount<0) return toast("المدة غير صحيحة.");
    if(amount>0) {
      const chosen=prompt("الوحدة: seconds / minutes / hours / days / months","hours");
      if(!["seconds","minutes","hours","days","months"].includes(chosen)) return toast("وحدة زمنية غير صحيحة.");
      unit=chosen;
    }
  }
  const {error}=await db.rpc("founder_set_user_restriction",{target_user_id:userId,restriction_kind:kind,duration_value:amount,duration_unit:unit});
  if(error) return toast(error.message);
  toast(kind==="mute"?"تم تطبيق الكتم.":"تم تطبيق الحظر.");
}
async function saveProfile() {
  const display_name=$("profile-name-input").value.trim();
  if(!display_name) return toast("اكتب اسم العرض.");
  const {data,error}=await db.from("profiles").update({display_name}).eq("id",state.user.id).select().single();
  if(error) return toast(error.message);
  state.me=data; $("my-name").textContent=profileName(data); toast("تم حفظ الملف الشخصي.");
}
function applyAccent(color) {
  document.documentElement.style.setProperty("--accent",color);
  document.documentElement.style.setProperty("--bubble-me",color);
  localStorage.setItem("nova-accent",color);
}
function applyTheme(theme) {
  const light=theme==="light";
  document.documentElement.style.setProperty("--bg",light?"#edf0f7":"#0b0e14");
  document.documentElement.style.setProperty("--panel",light?"#ffffff":"#111621");
  document.documentElement.style.setProperty("--panel2",light?"#eef1f8":"#171e2b");
  document.documentElement.style.setProperty("--text",light?"#182033":"#f5f6fb");
  document.documentElement.style.setProperty("--muted",light?"#667085":"#929bad");
  document.documentElement.style.colorScheme=light?"light":"dark";
  localStorage.setItem("nova-theme",theme);
}
async function enableNotifications() {
  if(!("Notification" in window)) return toast("هذا المتصفح لا يدعم الإشعارات.");
  const permission=await Notification.requestPermission();
  $("notification-state").textContent=permission==="granted"?"الإشعارات مفعّلة.":`الحالة: ${permission}`;
  if(permission==="granted") toast("تم تفعيل إشعارات هذا المتصفح.");
}
function notifyMessage(message) {
  if(!message || isMine(message) || Notification.permission!=="granted" || document.visibilityState==="visible") return;
  const now=Date.now(); if(now-state.lastNotificationAt<1200) return; state.lastNotificationAt=now;
  const title=message.sender?.display_name || "رسالة جديدة في NOVA";
  try { new Notification(title,{body:message.content || (message.media_type==="image"?"أرسل صورة":"أرسل رسالة صوتية"),icon:"./icon.svg",tag:message.id}); } catch {}
}
async function syncOpenChat() {
  if(!state.active) return;
  const before=new Set(state.messages.map(m=>m.id));
  const col=state.active.kind==="room"?"room_id":"conversation_id";
  const {data,error}=await db.from("messages").select("*,sender:profiles!messages_sender_id_fkey(id,username,display_name,avatar_url)").eq(col,state.active.id).order("created_at",{ascending:true}).limit(300);
  if(error) return;
  for(const m of data||[]) { if(!before.has(m.id)) notifyMessage(m); upsertMessage(m); }
}
async function backgroundSync() {
  try {
    await Promise.all([loadRooms(),loadConversations()]);
    await loadChatPreviews();
    await syncOpenChat();
    setConnection("متصل");
  } catch { setConnection("مزامنة محدودة"); }
}
function subscribeRealtime() {
  if(state.channel) db.removeChannel(state.channel);
  state.channel=db.channel(`nova-${state.user.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"messages"},async payload=>{
      const m=payload.new;
      if(!m?.id) return;
      if(state.active && ((state.active.kind==="room"&&m.room_id===state.active.id)||(state.active.kind==="conversation"&&m.conversation_id===state.active.id))) {
        const {data}=await db.from("messages").select("*,sender:profiles!messages_sender_id_fkey(id,username,display_name,avatar_url)").eq("id",m.id).maybeSingle();
        if(data) { if(payload.eventType==="INSERT") notifyMessage(data); upsertMessage(data); }
      }
      loadChatPreviews();
    })
    .on("postgres_changes",{event:"*",schema:"public",table:"rooms"},()=>{loadRooms().then(loadChatPreviews);})
    .on("postgres_changes",{event:"*",schema:"public",table:"conversations"},()=>{loadConversations().then(loadChatPreviews);})
    .on("postgres_changes",{event:"*",schema:"public",table:"announcements"},payload=>{
      if(payload.eventType==="INSERT" && payload.new?.body) toast(`إعلان: ${payload.new.body}`);
    })
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"profiles",filter:`id=eq.${state.user.id}`},payload=>{
      if(payload.new) { state.me={...state.me,...payload.new}; $("my-name").textContent=profileName(state.me); }
    })
    .subscribe(status=>setConnection(status==="SUBSCRIBED"?"متصل":"إعادة الاتصال…"));
}
async function enterApp(user) {
  state.user=user;
  $("auth-screen").classList.add("hidden"); $("app-shell").classList.remove("hidden"); $("bottom-nav").classList.remove("hidden");
  await loadProfile();
  if(state.me.ban_until && new Date(state.me.ban_until)>new Date()) {
    await db.auth.signOut(); throw new Error(`حسابك محظور حتى ${fmtDate(state.me.ban_until)}.`);
  }
  await loadRooms(); await loadConversations(); await loadChatPreviews();
  subscribeRealtime();
  clearInterval(state.pollTimer); state.pollTimer=setInterval(backgroundSync,1800);
  showView("chats-view");
}
async function init() {
  applyAccent(localStorage.getItem("nova-accent")||"#7c5cff");
  applyTheme(localStorage.getItem("nova-theme")||"dark");
  $("accent-color").value=localStorage.getItem("nova-accent")||"#7c5cff";
  $("notification-state").textContent=("Notification" in window)?`الحالة: ${Notification.permission}`:"غير مدعوم";
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
  const {data:{session}}=await db.auth.getSession();
  if(session?.user) { try { await enterApp(session.user); } catch(e) { toast(e.message); } }
  db.auth.onAuthStateChange(async(event,session)=>{
    if(event==="SIGNED_IN" && session?.user && !state.user) { try { await enterApp(session.user); } catch(e) { toast(e.message); } }
    if(event==="SIGNED_OUT") { state.user=null; state.me=null; clearInterval(state.pollTimer); $("app-shell").classList.add("hidden"); $("bottom-nav").classList.add("hidden"); $("auth-screen").classList.remove("hidden"); }
  });
}
$("auth-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("auth-email").value.trim(),password=$("auth-password").value;
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error) toast(error.message);
});
$("signup-btn").addEventListener("click",async()=>{
  const email=$("auth-email").value.trim(),password=$("auth-password").value,display_name=$("auth-display-name").value.trim();
  if(!email||password.length<6||!display_name) return toast("أدخل البريد وكلمة مرور من 6 أحرف واسم العرض.");
  const {error}=await db.auth.signUp({email,password,options:{data:{display_name}}});
  if(error) toast(error.message); else toast("تم إنشاء الحساب. تحقق من بريدك إذا طُلب ذلك.");
});
$("message-form").addEventListener("submit",async e=>{e.preventDefault();const input=$("message-input");const value=input.value;input.value="";await sendMessage({content:value});});
$("attach-image-btn").addEventListener("click",()=>$("image-input").click());
$("image-input").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  try { const url=await uploadMedia(file,"messages"); await sendMessage({media_url:url,media_type:"image"}); } catch(err) { toast(err.message); }
  e.target.value="";
});
$("record-btn").addEventListener("click",async()=>{
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("التسجيل الصوتي غير مدعوم في هذا المتصفح.");
  try {
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    state.audioChunks=[];
    state.mediaRecorder=new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable=e=>{if(e.data.size)state.audioChunks.push(e.data);};
    state.mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(state.audioChunks,{type:state.mediaRecorder.mimeType||"audio/webm"});
      try { const ext=blob.type.includes("mp4")?"m4a":"webm";const url=await uploadMedia(new File([blob],`voice.${ext}`,{type:blob.type}),"voice");await sendMessage({media_url:url,media_type:"audio"}); }
      catch(err){toast(err.message);}
      $("recording-status").classList.add("hidden");
    };
    state.mediaRecorder.start(); $("recording-status").classList.remove("hidden"); $("record-btn").disabled=true;
  } catch(err) { toast(`تعذر الوصول للميكروفون: ${err.message}`); }
});
$("stop-record-btn").addEventListener("click",()=>{if(state.mediaRecorder?.state==="recording"){state.mediaRecorder.stop();$("record-btn").disabled=false;}});
$("cancel-record-btn").addEventListener("click",()=>{if(state.mediaRecorder?.state==="recording"){state.mediaRecorder.onstop=()=>{};state.mediaRecorder.stop();$("record-btn").disabled=false;$("recording-status").classList.add("hidden");}});
$("chat-filters").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;state.filter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));renderChatList();});
$("global-search").addEventListener("input",renderChatList);
$("member-search-input").addEventListener("input",e=>loadMembers(e.target.value));
$("welcome-search-btn").addEventListener("click",()=>showView("members-view"));
$("bottom-nav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)showView(b.dataset.view);});
$("back-to-list").addEventListener("click",()=>{state.active=null;$("conversation-panel").classList.add("hidden");$("welcome-panel").classList.remove("hidden");});
$("new-group-btn").addEventListener("click",()=>$("group-dialog").showModal());
$("group-form").addEventListener("submit",async e=>{e.preventDefault();const name=$("group-name").value.trim();if(name){await createGroup(name);$("group-dialog").close();$("group-name").value="";}});
$("report-chat-btn").addEventListener("click",()=>openReport({}));
$("report-form").addEventListener("submit",submitReport);
$("conversation-info-btn").addEventListener("click",()=>{$("info-title").textContent=chatLabel(state.active||{});$("info-body").textContent=state.active?.description||"محادثة NOVA";$("info-dialog").showModal();});
$("close-info").addEventListener("click",()=>$("info-dialog").close());
$("theme-toggle").addEventListener("click",()=>applyTheme(localStorage.getItem("nova-theme")==="light"?"dark":"light"));
$("accent-color").addEventListener("input",e=>applyAccent(e.target.value));
$("reset-color-btn").addEventListener("click",()=>{applyAccent("#7c5cff");$("accent-color").value="#7c5cff";});
$("notifications-btn").addEventListener("click",enableNotifications);
$("profile-image-btn").addEventListener("click",()=>$("profile-image-input").click());
$("profile-image-input").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{const avatar_url=await uploadMedia(file,"profile");const {data,error}=await db.from("profiles").update({avatar_url}).eq("id",state.user.id).select().single();if(error)throw error;state.me=data;$("my-avatar").src=avatar_url;$("settings-avatar").src=avatar_url;toast("تم تحديث الصورة.");}catch(err){toast(err.message);}e.target.value="";
});
$("save-profile-btn").addEventListener("click",saveProfile);
$("open-reports-btn").addEventListener("click",loadReports);
$("logout-btn").addEventListener("click",()=>db.auth.signOut());
$("mobile-profile-btn").addEventListener("click",()=>showView("settings-view"));
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.deferredInstall=e;$("install-btn").classList.remove("hidden");});
$("install-btn").addEventListener("click",async()=>{if(!state.deferredInstall)return toast("استخدم قائمة المتصفح ثم إضافة إلى الشاشة الرئيسية.");state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.user)backgroundSync();});
init().catch(e=>toast(e.message));
