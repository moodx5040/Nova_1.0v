(() => {
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CONFIG = { url: "https://ushkxkocqgofhozkpctq.supabase.co", anonKey: "sb_publishable_TWdxStrX_8DsS7KsUm_41g_MVp0dhq3" };
let db, session, me, active = null, activeKind = null, activeRoom = null, activeConversation = null;
let authMode = "login", replyTo = null, uploadFile = null, realtime = [], presenceChannel = null, onlineUsers = new Set(), typingTimer = null;
const state = { rooms: [], dms: [], profiles: new Map(), messages: [], settings: {}, announcements: [], theme: localStorage.getItem("nova-theme") || "dark" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avatarFallback = name => `https://ui-avatars.com/api/?name=${encodeURIComponent(name||"N")}&background=202d48&color=fff&bold=true`;
const fmt = d => new Date(d).toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"});
const toast = (msg,type="") => { const el=document.createElement("div");el.className=`toast ${type}`;el.textContent=msg;$("#toastStack").append(el);setTimeout(()=>el.remove(),3500); };
const notice = (msg,error=false) => { $("#authNotice").textContent=msg;$("#authNotice").classList.toggle("error",error); };
const founder = () => me?.role === "founder";
const admin = () => ["founder","admin","moderator"].includes(me?.role);
const badgeText = role => ({founder:"✦ المؤسس",admin:"◆ إدارة",moderator:"◈ إشراف",vip:"VIP",verified:"موثّق"}[role]||"");
function setTheme(){document.body.classList.toggle("light",state.theme==="light");localStorage.setItem("nova-theme",state.theme);}
function modal(title, body, eyebrow="NOVA"){ $("#modalTitle").textContent=title;$("#modalEyebrow").textContent=eyebrow;$("#modalBody").innerHTML=body;$("#modalLayer").classList.remove("hidden"); }
function closeModal(){ $("#modalLayer").classList.add("hidden"); }
function showAuth(){ $("#authView").classList.remove("hidden");$("#appView").classList.add("hidden"); }
function showApp(){ $("#authView").classList.add("hidden");$("#appView").classList.remove("hidden"); }
function cleanRealtime(){ realtime.forEach(c=>db.removeChannel(c));realtime=[];if(presenceChannel){db.removeChannel(presenceChannel);presenceChannel=null;} }
async function init(){
 setTheme();
 if(CONFIG.url.includes("PASTE_")||CONFIG.anonKey.includes("PASTE_")){showAuth();notice("أضف رابط Supabase ومفتاح anon داخل app.js أولاً.",true);return;}
 db=window.supabase.createClient(CONFIG.url,CONFIG.anonKey);
 const {data:{session:s}}=await db.auth.getSession(); session=s;
 db.auth.onAuthStateChange(async(_e,s)=>{session=s;if(s)await boot();else{me=null;cleanRealtime();showAuth();}});
 if(session) await boot(); else showAuth();
}
async function boot(){
 const {data:userData,error:userErr}=await db.from("profiles").select("*").eq("id",session.user.id).single();
 if(userErr){toast("تعذر تحميل الملف الشخصي: "+userErr.message,"error");return;}
 me=userData;
 if(me.is_banned){await db.auth.signOut();toast("هذا الحساب موقوف عن استخدام المنصة.","error");return;}
 showApp();renderMe();await loadSettings();await loadRooms();await loadDMs();await loadAnnouncements();subscribeGlobal();await startPresence();
 if(!active && state.rooms.length) openRoom(state.rooms[0].id);
}
function renderMe(){
 $("#myName").textContent=me.display_name||me.username;$("#myHandle").textContent="@"+me.username;
 $("#myAvatar").src=me.avatar_url||avatarFallback(me.username);
 $("#founderBtn").classList.toggle("hidden",!founder());
}
async function loadSettings(){const {data}=await db.from("app_settings").select("key,value");state.settings=Object.fromEntries((data||[]).map(x=>[x.key,x.value]));}
async function loadRooms(){
 const {data,error}=await db.from("rooms").select("id,name,description,is_locked,is_archived,created_at").eq("is_archived",false).order("created_at");
 if(error){toast(error.message,"error");return;}state.rooms=data||[];renderRooms();
}
function renderRooms(){ $("#roomList").innerHTML=state.rooms.map(r=>`<button class="nav-item ${active===r.id&&activeKind==="room"?"active":""}" data-room="${r.id}"><span class="nav-symbol">#</span><span class="nav-label">${esc(r.name)}</span>${r.is_locked?'<small>🔒</small>':""}</button>`).join("");$$("[data-room]").forEach(b=>b.onclick=()=>openRoom(b.dataset.room));}
async function loadDMs(){
 const {data,error}=await db.from("conversations").select("id,user_a,user_b,last_message_at").or(`user_a.eq.${me.id},user_b.eq.${me.id}`).order("last_message_at",{ascending:false});
 if(error)return;state.dms=data||[];
 const ids=state.dms.map(c=>c.user_a===me.id?c.user_b:c.user_a);
 if(ids.length){const {data:p}=await db.from("profiles").select("id,username,display_name,avatar_url,role").in("id",ids);(p||[]).forEach(x=>state.profiles.set(x.id,x));}
 renderDMs();
}
function renderDMs(){ $("#dmList").innerHTML=state.dms.map(c=>{const id=c.user_a===me.id?c.user_b:c.user_a,p=state.profiles.get(id)||{};return `<button class="nav-item ${active===c.id&&activeKind==="dm"?"active":""}" data-dm="${c.id}"><span class="nav-symbol">◉</span><span class="nav-label">${esc(p.display_name||p.username||"محادثة")}</span></button>`}).join("");$$("[data-dm]").forEach(b=>b.onclick=()=>openDM(b.dataset.dm));}
async function loadAnnouncements(){const {data}=await db.from("announcements").select("*").eq("is_active",true).order("created_at",{ascending:false});state.announcements=data||[];$("#announcementDot").style.display=state.announcements.length?"block":"none";}
function subscribeGlobal(){
 const ch=db.channel("nova-global").on("postgres_changes",{event:"*",schema:"public",table:"rooms"},()=>loadRooms()).on("postgres_changes",{event:"*",schema:"public",table:"announcements"},()=>loadAnnouncements()).on("postgres_changes",{event:"*",schema:"public",table:"profiles",filter:`id=eq.${me.id}`},async()=>{const {data}=await db.from("profiles").select("*").eq("id",me.id).single();if(data){me=data;renderMe();}}).subscribe();realtime.push(ch);
}
async function startPresence(){
 presenceChannel=db.channel("nova-presence",{config:{presence:{key:me.id}}});
 presenceChannel.on("presence",{event:"sync"},()=>{const p=presenceChannel.presenceState();onlineUsers=new Set(Object.keys(p));$("#onlineCount").textContent=onlineUsers.size||1;});
 presenceChannel.on("broadcast",{event:"typing"},({payload})=>{if(payload.user!==me.id&&payload.target===active){$("#typingLine").textContent=`${payload.name} يكتب الآن...`;clearTimeout(typingTimer);typingTimer=setTimeout(()=>$("#typingLine").textContent="",2200);}});
 await presenceChannel.subscribe(async status=>{if(status==="SUBSCRIBED")await presenceChannel.track({user:me.id,name:me.display_name||me.username,online_at:new Date().toISOString()});});
}
async function openRoom(id){
 const r=state.rooms.find(x=>x.id===id);if(!r)return;if(r.is_locked&&!admin()){toast("هذه الغرفة مقفلة حالياً.");return;}
 active=id;activeKind="room";activeRoom=r;activeConversation=null;replyTo=null;$("#replyPreview").classList.add("hidden");
 $("#welcomePanel").classList.add("hidden");$("#chatPanel").classList.remove("hidden");$("#currentTitle").textContent=r.name;$("#currentSubtitle").textContent=r.description||"غرفة عامة";$("#currentRoomIcon").textContent="#";$("#infoTitle").textContent=r.name;$("#infoDescription").textContent=r.description||"مساحة عامة";$("#pinnedBanner").classList.add("hidden");
 renderRooms();renderDMs();await loadMessages();await loadMembers();
 const ch=db.channel("room-"+id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${id}`},p=>{if(!state.messages.some(m=>m.id===p.new.id)){state.messages.push(p.new);hydrateAndRender();}}).on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages",filter:`room_id=eq.${id}`},p=>{state.messages=state.messages.map(m=>m.id===p.new.id?p.new:m);hydrateAndRender();}).subscribe();realtime.push(ch);
}
async function openDM(id){
 const c=state.dms.find(x=>x.id===id);if(!c)return;active=id;activeKind="dm";activeConversation=c;activeRoom=null;replyTo=null;$("#replyPreview").classList.add("hidden");
 const uid=c.user_a===me.id?c.user_b:c.user_a,p=state.profiles.get(uid)||{};
 $("#welcomePanel").classList.add("hidden");$("#chatPanel").classList.remove("hidden");$("#currentTitle").textContent=p.display_name||p.username||"محادثة خاصة";$("#currentSubtitle").textContent="محادثة خاصة بينك وبين هذا العضو";$("#currentRoomIcon").textContent="◉";$("#infoTitle").textContent=$("#currentTitle").textContent;$("#infoDescription").textContent="رسائلكما خاصة";$("#pinnedBanner").classList.add("hidden");
 renderRooms();renderDMs();await loadMessages();$("#memberList").innerHTML="";$("#memberCount").textContent="2";
 const ch=db.channel("dm-"+id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`conversation_id=eq.${id}`},p=>{if(!state.messages.some(m=>m.id===p.new.id)){state.messages.push(p.new);hydrateAndRender();}}).on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages",filter:`conversation_id=eq.${id}`},p=>{state.messages=state.messages.map(m=>m.id===p.new.id?p.new:m);hydrateAndRender();}).subscribe();realtime.push(ch);
}
async function loadMessages(){
 const q=db.from("messages").select("*").order("created_at",{ascending:true}).limit(100);
 const {data,error}=activeKind==="room"?await q.eq("room_id",active):await q.eq("conversation_id",active);
 if(error){toast(error.message,"error");return;}state.messages=data||[];await hydrateAndRender();
}
async function hydrateAndRender(){
 const ids=[...new Set(state.messages.map(m=>m.sender_id))].filter(id=>!state.profiles.has(id));
 if(ids.length){const {data}=await db.from("profiles").select("id,username,display_name,avatar_url,role").in("id",ids);(data||[]).forEach(p=>state.profiles.set(p.id,p));}
 const msgIds=state.messages.map(m=>m.id);let reactions={};
 if(msgIds.length){const {data}=await db.from("message_reactions").select("*").in("message_id",msgIds);(data||[]).forEach(r=>(reactions[r.message_id]??=[]).push(r));}
 $("#messages").innerHTML=state.messages.map(m=>renderMessage(m,reactions[m.id]||[])).join("");
 $("#messages").scrollTop=$("#messages").scrollHeight;
}
function renderMessage(m,reactions){
 const p=state.profiles.get(m.sender_id)||{username:"عضو",display_name:"عضو"};
 const mine=m.sender_id===me.id,role=p.role||"member",badge=badgeText(role);
 let body=m.deleted_at?"تم حذف هذه الرسالة":esc(m.body||"").replace(/\n/g,"<br>");
 if(m.attachment_url&&!m.deleted_at){body+=m.attachment_type?.startsWith("image/")?`<br><a href="${esc(m.attachment_url)}" target="_blank" rel="noopener"><img src="${esc(m.attachment_url)}" alt="مرفق"></a>`:`<br><a href="${esc(m.attachment_url)}" target="_blank" rel="noopener">📎 فتح المرفق</a>`;}
 const reply=m.reply_to?state.messages.find(x=>x.id===m.reply_to):null;
 return `<article class="message ${mine?"mine":""}"><img class="avatar" src="${esc(p.avatar_url||avatarFallback(p.username))}" alt=""><div class="bubble-wrap"><div class="message-meta"><span class="message-name">${esc(p.display_name||p.username)}</span>${badge?`<span class="role-badge">${badge}</span>`:""}<time>${fmt(m.created_at)}</time>${m.edited_at?"<small>معدّلة</small>":""}</div><div class="bubble ${m.deleted_at?"deleted":""}">${reply&&!m.deleted_at?`<div class="reply-quote">${esc((reply.body||"رسالة").slice(0,90))}</div>`:""}${body}</div>${reactions.length?`<div class="reaction-row">${reactions.map(r=>`<button class="reaction" data-react="${m.id}" data-emoji="${esc(r.emoji)}">${esc(r.emoji)} ${r.count||1}</button>`).join("")}</div>`:""}<div class="message-tools"><button data-reply="${m.id}">رد</button><button data-react-add="${m.id}">♥</button>${mine&&!m.deleted_at?`<button data-edit="${m.id}">تعديل</button><button data-delete="${m.id}">حذف</button>`:""}${founder()&&!m.deleted_at&&!mine?`<button data-mod-delete="${m.id}">حذف إداري</button>`:""}<button data-report="${m.id}">إبلاغ</button></div></div></article>`;
}
$("#messages").addEventListener("click",async e=>{
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.reply){const m=state.messages.find(x=>x.id===b.dataset.reply);replyTo=m.id;$("#replyText").textContent=(m.body||"مرفق").slice(0,90);$("#replyPreview").classList.remove("hidden");$("#messageInput").focus();}
 if(b.dataset.edit){const m=state.messages.find(x=>x.id===b.dataset.edit);const value=prompt("عدّل رسالتك:",m.body);if(value?.trim()){const {error}=await db.from("messages").update({body:value.trim(),edited_at:new Date().toISOString()}).eq("id",m.id);if(error)toast(error.message,"error");else await loadMessages();}}
 if(b.dataset.delete){if(confirm("حذف الرسالة؟")){const {error}=await db.from("messages").update({deleted_at:new Date().toISOString(),body:""}).eq("id",b.dataset.delete);if(error)toast(error.message,"error");else await loadMessages();}}
 if(b.dataset.modDelete){if(confirm("حذف هذه الرسالة بصلاحية المؤسس؟")){const {error}=await db.rpc("founder_delete_message",{p_message_id:b.dataset.modDelete});if(error)toast(error.message,"error");else{toast("تم حذف الرسالة.","success");await loadMessages();}}}
 if(b.dataset.reactAdd){const emoji=prompt("اكتب رمز التفاعل:","❤️");if(emoji){const {error}=await db.from("message_reactions").upsert({message_id:b.dataset.reactAdd,user_id:me.id,emoji},{onConflict:"message_id,user_id"});if(error)toast(error.message,"error");else await hydrateAndRender();}}
 if(b.dataset.report){const reason=prompt("سبب الإبلاغ:");if(reason?.trim()){const {error}=await db.from("reports").insert({reporter_id:me.id,message_id:b.dataset.report,reason:reason.trim()});toast(error?"تعذر إرسال البلاغ":"تم إرسال البلاغ للمراجعة",error?"error":"success");}}
 if(b.dataset.react){const {error}=await db.from("message_reactions").delete().eq("message_id",b.dataset.react).eq("user_id",me.id);if(error)toast(error.message,"error");else await hydrateAndRender();}
});
async function sendMessage(){
 const body=$("#messageInput").value.trim();if(!body&&!uploadFile)return;
 let attachment_url=null,attachment_type=null;
 if(uploadFile){const ext=uploadFile.name.split(".").pop(),path=`${me.id}/${crypto.randomUUID()}.${ext}`;const {error:upErr}=await db.storage.from("chat-media").upload(path,uploadFile,{upsert:false,contentType:uploadFile.type});if(upErr){toast("فشل رفع المرفق: "+upErr.message,"error");return;}const {data}=db.storage.from("chat-media").getPublicUrl(path);attachment_url=data.publicUrl;attachment_type=uploadFile.type;uploadFile=null;$("#attachment").value="";}
 const payload={sender_id:me.id,body,reply_to:replyTo,attachment_url,attachment_type};if(activeKind==="room")payload.room_id=active;else payload.conversation_id=active;
 const {error}=await db.from("messages").insert(payload);if(error){toast(error.message,"error");return;}
 $("#messageInput").value="";$("#charCount").textContent="0 / 4000";replyTo=null;$("#replyPreview").classList.add("hidden");$("#messageInput").style.height="auto";
 await loadMessages();
}
async function loadMembers(){
 if(!activeRoom)return;const {data:members}=await db.from("room_members").select("user_id").eq("room_id",active);const ids=(members||[]).map(x=>x.user_id);
 if(!ids.length){$("#memberList").innerHTML="";$("#memberCount").textContent="0";return;}
 const {data}=await db.from("profiles").select("id,username,display_name,avatar_url,role").in("id",ids);$("#memberCount").textContent=(data||[]).length;
 $("#memberList").innerHTML=(data||[]).map(p=>`<div class="member-item"><img class="avatar" src="${esc(p.avatar_url||avatarFallback(p.username))}"><b>${esc(p.display_name||p.username)}</b><span>${badgeText(p.role)||"عضو"}</span></div>`).join("");
}
async function openNewDM(){
 modal("ابدأ محادثة خاصة",`<label class="modal-label">اسم المستخدم<input id="dmUsername" class="modal-input" placeholder="اكتب اسم المستخدم بدون @"></label><div class="modal-actions"><button class="btn primary" id="startDm">بدء المحادثة</button></div>`);
 $("#startDm").onclick=async()=>{const username=$("#dmUsername").value.trim().replace(/^@/,"");if(!username)return;const {data:p,error}=await db.from("profiles").select("id,username,display_name,avatar_url,role").eq("username",username).maybeSingle();if(error||!p){toast("لم يتم العثور على هذا المستخدم","error");return;}if(p.id===me.id){toast("لا يمكنك بدء محادثة مع نفسك.");return;}const {data:cid,error:e}=await db.rpc("start_dm",{p_other_user:p.id});if(e){toast(e.message,"error");return;}state.profiles.set(p.id,p);await loadDMs();closeModal();openDM(cid);};
}
function openProfile(){
 modal("إعدادات حسابك",`<div class="form-stack"><label class="modal-label">اسم العرض<input id="editDisplay" class="modal-input" maxlength="32" value="${esc(me.display_name||"")}"></label><label class="modal-label">نبذة قصيرة<input id="editBio" class="modal-input" maxlength="160" value="${esc(me.bio||"")}"></label><label class="modal-label">رابط الصورة الشخصية<input id="editAvatar" class="modal-input" value="${esc(me.avatar_url||"")}" placeholder="https://..."></label><label class="modal-label">الحالة<input id="editStatus" class="modal-input" maxlength="80" value="${esc(me.status_text||"")}"></label><div class="modal-actions"><button class="btn primary" id="saveProfile">حفظ التغييرات</button></div></div>`);
 $("#saveProfile").onclick=async()=>{const patch={display_name:$("#editDisplay").value.trim(),bio:$("#editBio").value.trim(),avatar_url:$("#editAvatar").value.trim()||null,status_text:$("#editStatus").value.trim()};const {error}=await db.from("profiles").update(patch).eq("id",me.id);if(error)toast(error.message,"error");else{me={...me,...patch};renderMe();closeModal();toast("تم تحديث ملفك الشخصي","success");}};
}
function openNewRoom(){
 modal("إنشاء مساحة جديدة",`<div class="form-stack"><label class="modal-label">اسم الغرفة<input id="roomName" class="modal-input" maxlength="32" placeholder="مثال: general"></label><label class="modal-label">وصف الغرفة<input id="roomDesc" class="modal-input" maxlength="140" placeholder="عن ماذا نتحدث هنا؟"></label><div class="modal-actions"><button class="btn primary" id="createRoom">إنشاء الغرفة</button></div></div>`);
 $("#createRoom").onclick=async()=>{const name=$("#roomName").value.trim(),description=$("#roomDesc").value.trim();if(!name)return;const {error}=await db.rpc("create_room",{p_name:name,p_description:description});if(error)toast(error.message,"error");else{closeModal();await loadRooms();toast("تم إنشاء الغرفة","success");}};
}
function openAnnouncements(){
 const body=state.announcements.length?state.announcements.map(a=>`<article class="admin-row"><div class="grow"><b>${esc(a.title)}</b><small>${esc(a.body)} · ${new Date(a.created_at).toLocaleDateString("ar-SA")}</small></div>${a.is_pinned?"📌":""}</article>`).join(""):"<p class='muted'>لا توجد إعلانات حالياً.</p>";
 modal("إعلانات NOVA",body,"COMMUNITY UPDATES");
}
function openMembers(){
 if(activeKind==="room")loadMembers();modal("أعضاء الغرفة",`<p class="muted">قائمة الأعضاء تظهر حسب الغرفة المختارة.</p><div id="modalMembers" class="member-list">${$("#memberList").innerHTML}</div>`);
}
function founderPanel(){
 if(!founder())return;
 modal("مركز المؤسس",`<div class="stat-grid"><div class="stat-card"><b id="statUsers">—</b><small>الأعضاء</small></div><div class="stat-card"><b id="statRooms">—</b><small>الغرف</small></div><div class="stat-card"><b id="statReports">—</b><small>البلاغات</small></div></div>
 <div class="admin-actions"><button class="btn secondary" id="adminMembers">إدارة الأعضاء</button><button class="btn secondary" id="adminRooms">إدارة الغرف</button><button class="btn secondary" id="adminReports">مراجعة البلاغات</button><button class="btn secondary" id="adminAnnouncement">نشر إعلان</button><button class="btn secondary" id="adminSettings">إعدادات المنصة</button><button class="btn secondary" id="adminAudit">سجل الإدارة</button></div><p class="tiny muted">صلاحيات المؤسس محمية في قاعدة البيانات، وليست مجرد عناصر واجهة.</p>`, "FOUNDER CONTROL");
 Promise.all([db.from("profiles").select("id",{count:"exact",head:true}),db.from("rooms").select("id",{count:"exact",head:true}),db.from("reports").select("id",{count:"exact",head:true}).eq("status","open")]).then(([u,r,b])=>{$("#statUsers").textContent=u.count??"—";$("#statRooms").textContent=r.count??"—";$("#statReports").textContent=b.count??"—";});
 $("#adminMembers").onclick=adminMembers;$("#adminRooms").onclick=adminRooms;$("#adminReports").onclick=adminReports;$("#adminAnnouncement").onclick=adminAnnouncement;$("#adminSettings").onclick=adminSettings;$("#adminAudit").onclick=adminAudit;
}
async function adminMembers(){
 const {data,error}=await db.from("profiles").select("id,username,display_name,role,is_banned,muted_until").order("created_at",{ascending:false}).limit(100);if(error){toast(error.message,"error");return;}
 modal("إدارة الأعضاء",`<input id="memberSearch" class="modal-input" placeholder="بحث باسم المستخدم"><div id="adminMemberList" class="modal-body">${(data||[]).map(p=>memberAdminRow(p)).join("")}</div>`,"FOUNDER / MEMBERS");
 $("#memberSearch").oninput=e=>$$(".admin-row[data-search]").forEach(row=>row.style.display=row.dataset.search.includes(e.target.value.toLowerCase())?"flex":"none");
}
function memberAdminRow(p){return `<div class="admin-row" data-search="${esc((p.username+" "+p.display_name).toLowerCase())}"><div class="grow"><b>${esc(p.display_name||p.username)} ${p.role==="founder"?"✦":""}</b><small>@${esc(p.username)} · ${esc(p.role)} · ${p.is_banned?"محظور":"نشط"}</small></div>${p.role!=="founder"?`<button class="btn secondary" data-user-action="badge" data-id="${p.id}">شارة</button><button class="btn secondary" data-user-action="mute" data-id="${p.id}">كتم</button><button class="btn ${p.is_banned?"secondary":"danger"}" data-user-action="ban" data-id="${p.id}" data-banned="${p.is_banned}">${p.is_banned?"فك الحظر":"حظر"}</button>`:""}</div>`;}
$("#modalBody").addEventListener("click",async e=>{
 const b=e.target.closest("[data-user-action]");if(!b)return;const id=b.dataset.id,action=b.dataset.userAction;
 if(action==="ban"){const {error}=await db.rpc("founder_set_ban",{p_user_id:id,p_banned:b.dataset.banned!=="true"});if(error)toast(error.message,"error");else{toast("تم تحديث حالة العضو","success");adminMembers();}}
 if(action==="mute"){const mins=Number(prompt("مدة الكتم بالدقائق:",60));if(!mins||mins<1)return;const {error}=await db.rpc("founder_mute_user",{p_user_id:id,p_minutes:mins});if(error)toast(error.message,"error");else toast("تم كتم العضو","success");}
 if(action==="badge"){const role=prompt("اكتب نوع الشارة: member أو vip أو verified أو moderator أو admin","vip");if(!role)return;const {error}=await db.rpc("founder_set_role",{p_user_id:id,p_role:role});if(error)toast(error.message,"error");else{toast("تم تحديث الشارة/الدور","success");adminMembers();}}
});
async function adminRooms(){
 const {data,error}=await db.from("rooms").select("*").order("created_at",{ascending:false});if(error){toast(error.message,"error");return;}
 modal("إدارة الغرف",`${(data||[]).map(r=>`<div class="admin-row"><div class="grow"><b># ${esc(r.name)}</b><small>${esc(r.description||"")} · ${r.is_locked?"مقفلة":"مفتوحة"} · ${r.is_archived?"مؤرشفة":"نشطة"}</small></div><button class="btn secondary" data-room-lock="${r.id}" data-value="${r.is_locked}">${r.is_locked?"فتح":"تجميد"}</button><button class="btn danger" data-room-archive="${r.id}">أرشفة</button></div>`).join("")}`);
 $("#modalBody").querySelectorAll("[data-room-lock]").forEach(b=>b.onclick=async()=>{const {error}=await db.rpc("founder_lock_room",{p_room_id:b.dataset.roomLock,p_locked:b.dataset.value!=="true"});if(error)toast(error.message,"error");else{await loadRooms();adminRooms();}});
 $("#modalBody").querySelectorAll("[data-room-archive]").forEach(b=>b.onclick=async()=>{if(!confirm("أرشفة الغرفة؟"))return;const {error}=await db.rpc("founder_archive_room",{p_room_id:b.dataset.roomArchive});if(error)toast(error.message,"error");else{await loadRooms();adminRooms();}});
}
async function adminReports(){
 const {data,error}=await db.from("reports").select("id,reason,status,created_at,message_id,reporter_id").eq("status","open").order("created_at",{ascending:false});if(error){toast(error.message,"error");return;}
 modal("مراجعة البلاغات",(data||[]).map(r=>`<div class="admin-row"><div class="grow"><b>${esc(r.reason)}</b><small>بلاغ ${new Date(r.created_at).toLocaleString("ar-SA")}</small></div><button class="btn secondary" data-report-done="${r.id}">إغلاق البلاغ</button></div>`).join("")||"<p class='muted'>لا توجد بلاغات مفتوحة.</p>");
 $("#modalBody").querySelectorAll("[data-report-done]").forEach(b=>b.onclick=async()=>{const {error}=await db.rpc("founder_close_report",{p_report_id:b.dataset.reportDone});if(error)toast(error.message,"error");else adminReports();});
}
function adminAnnouncement(){
 modal("نشر إعلان",`<label class="modal-label">عنوان الإعلان<input id="announceTitle" class="modal-input" maxlength="90"></label><label class="modal-label">نص الإعلان<textarea id="announceBody" class="modal-input" rows="4" maxlength="1000"></textarea></label><label class="modal-label"><input id="announcePinned" type="checkbox"> تثبيت الإعلان</label><button class="btn primary" id="publishAnnouncement">نشر الآن</button>`);
 $("#publishAnnouncement").onclick=async()=>{const title=$("#announceTitle").value.trim(),body=$("#announceBody").value.trim();if(!title||!body)return;const {error}=await db.rpc("founder_publish_announcement",{p_title:title,p_body:body,p_pinned:$("#announcePinned").checked});if(error)toast(error.message,"error");else{await loadAnnouncements();closeModal();toast("تم نشر الإعلان","success");}};
}
function adminSettings(){
 const maintenance=!!state.settings.maintenance?.enabled;
 modal("إعدادات المنصة",`<label class="modal-label"><input id="maintenanceToggle" type="checkbox" ${maintenance?"checked":""}> وضع الصيانة</label><label class="modal-label">رسالة الصيانة<input id="maintenanceText" class="modal-input" value="${esc(state.settings.maintenance?.message||"نعود إليكم قريباً.")}"></label><label class="modal-label">كلمات ممنوعة، افصل بينها بفاصلة<textarea id="blockedWords" class="modal-input" rows="3">${esc((state.settings.blocked_words||[]).join(", "))}</textarea></label><button class="btn primary" id="savePlatform">حفظ الإعدادات</button>`);
 $("#savePlatform").onclick=async()=>{const {error}=await db.rpc("founder_update_settings",{p_maintenance:$("#maintenanceToggle").checked,p_message:$("#maintenanceText").value,p_words:$("#blockedWords").value.split(",").map(x=>x.trim()).filter(Boolean)});if(error)toast(error.message,"error");else{await loadSettings();closeModal();toast("تم تحديث إعدادات المنصة","success");}};
}
async function adminAudit(){const {data,error}=await db.from("admin_logs").select("*").order("created_at",{ascending:false}).limit(80);if(error){toast(error.message,"error");return;}modal("سجل الإدارة",(data||[]).map(x=>`<div class="admin-row"><div class="grow"><b>${esc(x.action)}</b><small>${esc(JSON.stringify(x.details||{}))} · ${new Date(x.created_at).toLocaleString("ar-SA")}</small></div></div>`).join("")||"<p class='muted'>لا توجد عمليات مسجلة.</p>");}
async function reportRoom(){const reason=prompt("ما سبب الإبلاغ؟");if(!reason?.trim())return;const {error}=await db.from("reports").insert({reporter_id:me.id,room_id:activeRoom?.id,reason:reason.trim()});toast(error?"تعذر إرسال البلاغ":"وصل بلاغك للمراجعة",error?"error":"success");}
$("#authForm").addEventListener("submit",async e=>{
 e.preventDefault();if(!db)return;const email=$("#email").value.trim(),password=$("#password").value,username=$("#username").value.trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
 if(username.length<3){notice("اسم المستخدم يجب أن يكون 3 أحرف على الأقل ويحتوي أحرفاً إنجليزية أو أرقاماً أو _.",true);return;}
 $("#authSubmit").disabled=true;
 if(authMode==="signup"){
  const {data,error}=await db.auth.signUp({email,password,options:{data:{username,display_name:$("#displayName").value.trim()||username}}});
  if(error)notice(error.message,true);else if(data.session){notice("تم إنشاء الحساب.");}else notice("تم إنشاء الحساب. افحص بريدك لتأكيده ثم سجّل الدخول.");
 }else{const {error}=await db.auth.signInWithPassword({email,password});if(error)notice(error.message,true);}
 $("#authSubmit").disabled=false;
});
$$("[data-auth-tab]").forEach(b=>b.onclick=()=>{authMode=b.dataset.authTab;$$("[data-auth-tab]").forEach(x=>x.classList.toggle("active",x===b));$("#displayNameField").classList.toggle("hidden",authMode!=="signup");$("#authSubmit").innerHTML=authMode==="signup"?"إنشاء حساب <span>←</span>":"دخول إلى NOVA <span>←</span>";notice("");});
$("#messageForm").onsubmit=e=>{e.preventDefault();sendMessage();};
$("#messageInput").oninput=()=>{$("#charCount").textContent=$("#messageInput").value.length+" / 4000";$("#messageInput").style.height="auto";$("#messageInput").style.height=Math.min($("#messageInput").scrollHeight,130)+"px";if(presenceChannel&&active)presenceChannel.send({type:"broadcast",event:"typing",payload:{user:me.id,name:me.display_name||me.username,target:active}});};
$("#messageInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}};
$("#attachment").onchange=e=>{uploadFile=e.target.files[0]||null;if(uploadFile)toast("تم اختيار: "+uploadFile.name);};
$("#cancelReply").onclick=()=>{replyTo=null;$("#replyPreview").classList.add("hidden");};
$("#profileSettingsBtn").onclick=openProfile;$("#newRoomBtn").onclick=openNewRoom;$("#newDmBtn").onclick=openNewDM;$("#founderBtn").onclick=founderPanel;$("#announcementsBtn").onclick=openAnnouncements;$("#membersBtn").onclick=openMembers;$("#reportRoomBtn").onclick=reportRoom;$("#themeBtn").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";setTheme();};$("#logoutBtn").onclick=()=>db.auth.signOut();$("#modalClose").onclick=closeModal;$("#modalLayer").onclick=e=>{if(e.target.id==="modalLayer")closeModal();};$("#openSidebar").onclick=()=>$("#sidebar").classList.add("open");$("#closeSidebar").onclick=()=>$("#sidebar").classList.remove("open");$("#closeInfo").onclick=()=>$("#infoPanel").classList.toggle("hidden");
$("#emojiBtn").onclick=()=>{const e=prompt("اختر رمزاً لإضافته:","😊");if(e){$("#messageInput").value+=$("#messageInput").value?` ${e}`:e;$("#messageInput").dispatchEvent(new Event("input"));}};
init();
})();
