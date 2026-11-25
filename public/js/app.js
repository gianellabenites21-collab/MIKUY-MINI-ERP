const $ = (id) => document.getElementById(id);
const state = { supabase: null, session: null, profile: null, tables: [], products: [], ingredients: [], orders: [], categories: [], voiceItems: [] };
const money = n => `S/ ${Number(n || 0).toFixed(2)}`;
const dateText = d => new Date(d).toLocaleString("es-PE", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
const statusText = s => ({pendiente:"Pendiente", preparando:"En preparación", preparado:"Preparado", entregado:"Entregado", cancelado:"Cancelado"})[s] || s;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(message) { const t=$("toast"); t.textContent=message; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000); }
function showAuthMessage(message, error=true) { $("authMessage").textContent=message; $("authMessage").style.color=error?"#c86f5e":"#4e8a5b"; }
function setBusy(btn, busy, label) { btn.disabled=busy; if(label) btn.textContent=busy?"Procesando…":label; }

async function init() {
  $("todayLabel").textContent = new Date().toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  try {
    const cfg = await fetch("./config.json", {cache:"no-store"}).then(r=>r.ok?r.json():null);
    if(cfg?.SUPABASE_URL && cfg?.SUPABASE_ANON_KEY && window.supabase) {
      state.supabase = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
      const {data:{session}} = await state.supabase.auth.getSession();
      state.session=session;
      if(session) await enterApp();
      state.supabase.auth.onAuthStateChange(async (_event,session)=>{state.session=session;if(session) await enterApp();else showLogin();});
    }
  } catch(e) { console.error(e); }
  $("loginBtn").addEventListener("click",login);
  $("signupBtn").addEventListener("click",signup);
  $("logoutBtn").addEventListener("click",logout);
  document.querySelectorAll(".nav-link").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
  document.querySelectorAll("[data-close-modal]").forEach(b=>b.addEventListener("click",closeModal));
  $("newOrderBtn").addEventListener("click",()=>openOrderModal());
  $("addIngredientBtn").addEventListener("click",()=>openIngredientModal());
  $("addProductBtn").addEventListener("click",()=>openProductModal());
  $("orderFilter").addEventListener("change",renderOrders); $("orderSearch").addEventListener("input",renderOrders);
  $("ingredientFilter").addEventListener("change",renderInventory); $("ingredientSearch").addEventListener("input",renderInventory);
  $("micBtn").addEventListener("click",startRecognition); $("interpretBtn").addEventListener("click",interpretVoice); $("confirmVoiceBtn").addEventListener("click",confirmVoiceOrder);
  $("confirmVoiceBtn").disabled=true;
}
function showLogin(){ $("loginScreen").classList.remove("hidden");$("appShell").classList.add("hidden"); }
async function login(){
  if(!state.supabase) return showAuthMessage("Configura Supabase en public/config.json y vuelve a cargar.");
  const email=$("loginEmail").value.trim(),password=$("loginPassword").value;
  if(!email||!password)return showAuthMessage("Completa el correo y la contraseña.");
  setBusy($("loginBtn"),true);
  const {error}=await state.supabase.auth.signInWithPassword({email,password});
  setBusy($("loginBtn"),false,"Ingresar →");
  if(error)showAuthMessage(error.message);
}
async function signup(){
  if(!state.supabase)return showAuthMessage("Configura Supabase antes de crear una cuenta.");
  const email=$("loginEmail").value.trim(),password=$("loginPassword").value;
  if(!email||password.length<6)return showAuthMessage("Ingresa un correo y una contraseña de al menos 6 caracteres.");
  setBusy($("signupBtn"),true);
  const {error}=await state.supabase.auth.signUp({email,password});
  setBusy($("signupBtn"),false,"Crear cuenta de acceso");
  if(error)showAuthMessage(error.message);else showAuthMessage("Cuenta creada. Si Supabase solicita confirmar el correo, revisa tu bandeja.",false);
}
async function logout(){if(state.supabase)await state.supabase.auth.signOut();showLogin();}
async function enterApp(){
  if(!state.supabase||!state.session)return;
  $("loginScreen").classList.add("hidden");$("appShell").classList.remove("hidden");
  const {data:userData}=await state.supabase.auth.getUser();
  const email=userData.user?.email||"Usuario";
  const {data:profile}=await state.supabase.from("usuarios").select("*").eq("id",userData.user.id).maybeSingle();
  state.profile=profile;
  $("userName").textContent=profile?.nombre||email.split("@")[0];
  $("userRole").textContent=profile?.rol||"Personal";
  $("userAvatar").textContent=(profile?.nombre||email).charAt(0).toUpperCase();
  await loadAll();
}
async function loadAll(){
  if(!state.supabase)return;
  const db=state.supabase;
  const [tables,products,ingredients,orders,categories]=await Promise.all([
    db.from("mesas").select("*").order("numero"),
    db.from("productos").select("*, categorias(nombre)").eq("activo",true).order("nombre"),
    db.from("ingredientes").select("*").order("nombre"),
    db.from("pedidos").select("*, mesas(numero), detalle_pedidos(id,cantidad,precio_unitario,productos(nombre))").order("created_at",{ascending:false}).limit(100),
    db.from("categorias").select("*").order("nombre")
  ]);
  for(const r of [tables,products,ingredients,orders,categories])if(r.error){console.error(r.error);toast("No se pudieron cargar algunos datos: "+r.error.message);}
  state.tables=tables.data||[];state.products=products.data||[];state.ingredients=ingredients.data||[];state.orders=orders.data||[];state.categories=categories.data||[];window.categories=state.categories;
  renderAll();
}
function renderAll(){renderDashboard();renderTables();renderOrders();renderInventory();renderMenu();fillVoiceTables();}
function navigate(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${view}`));
  document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const titles={dashboard:"Resumen general",mesas:"Mapa de mesas",pedidos:"Gestión de pedidos",voz:"Pedido por voz",inventario:"Control de inventario",menu:"Menú y recetas"};
  $("pageTitle").textContent=titles[view]||"Mikuy";$("topEyebrow").textContent=(view==="dashboard"?"PANEL DE CONTROL":"GESTIÓN DEL RESTAURANTE");
  if(view==="mesas")renderTables();
}
function renderDashboard(){
  const free=state.tables.filter(t=>t.estado==="disponible").length,busy=state.tables.filter(t=>t.estado==="ocupada").length,reserved=state.tables.filter(t=>t.estado==="reservada").length;
  $("statFree").textContent=free;$("statOrders").textContent=state.orders.filter(o=>["pendiente","preparando"].includes(o.estado)).length;
  $("statLow").textContent=state.ingredients.filter(i=>Number(i.stock_actual)<=Number(i.stock_minimo)).length;
  const today=new Date().toISOString().slice(0,10);
  $("statSales").textContent=money(state.orders.filter(o=>o.created_at?.slice(0,10)===today&&!["cancelado"].includes(o.estado)).reduce((s,o)=>s+Number(o.total),0));
  $("miniTables").innerHTML=state.tables.map(t=>`<div class="mini-table ${t.estado==="ocupada"?"busy":t.estado==="reservada"?"reserved":""}">M${String(t.numero).padStart(2,"0")}</div>`).join("")||'<p class="empty-state">No hay mesas. Ejecuta database/schema.sql.</p>';
  $("recentOrders").innerHTML=state.orders.slice(0,5).map(o=>`<div class="recent-item"><div><strong>Pedido #${o.id.slice(0,8)} · Mesa ${o.mesas?.numero||"—"}</strong><small>${dateText(o.created_at)} · ${statusText(o.estado)}</small></div><span class="recent-total">${money(o.total)}</span></div>`).join("")||'<div class="empty-state">Aún no hay pedidos registrados.</div>';
  $("dashboardAlerts").innerHTML=state.ingredients.filter(i=>Number(i.stock_actual)<=Number(i.stock_minimo)).slice(0,8).map(i=>`<span class="alert-chip">⚠ ${esc(i.nombre)} · ${i.stock_actual} ${esc(i.unidad)}</span>`).join("")||'<span class="muted">No hay alertas de stock. ¡Buen trabajo!</span>';
}
function renderTables(){
  const counts={disponible:0,ocupada:0,reservada:0};state.tables.forEach(t=>counts[t.estado]=(counts[t.estado]||0)+1);
  $("freePill").textContent=`${counts.disponible||0} disponibles`;$("busyPill").textContent=`${counts.ocupada||0} ocupadas`;$("reservedPill").textContent=`${counts.reservada||0} reservadas`;
  $("tableMap").innerHTML=state.tables.map(t=>`<button class="table-card ${t.estado==="ocupada"?"busy":t.estado==="reservada"?"reserved":""}" data-table="${t.id}"><span class="chair-icon">♧</span><strong>MESA ${String(t.numero).padStart(2,"0")}</strong><small>${t.estado==="disponible"?"Disponible":t.estado==="ocupada"?"Ocupada":"Reservada"} · ${t.capacidad} pers.</small></button>`).join("")||'<div class="empty-state">No hay mesas registradas. Ejecuta el script SQL inicial.</div>';
  document.querySelectorAll("[data-table]").forEach(b=>b.addEventListener("click",()=>openTableDetail(b.dataset.table)));
}
async function openTableDetail(id){
  const table=state.tables.find(t=>t.id===id);if(!table)return;
  const active=state.orders.filter(o=>o.mesa_id===id&&!["entregado","cancelado"].includes(o.estado));
  openModal(`Mesa ${String(table.numero).padStart(2,"0")}`,"ESTADO DE MESA",`<p>Estado actual: <b>${esc(table.estado)}</b></p><p class="muted">${active.length} pedido(s) activo(s).</p><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Cerrar</button>${table.estado==="disponible"?`<button class="btn btn-primary" id="tableNewOrder">Crear pedido</button>`:``}${table.estado==="reservada"?`<button class="btn btn-primary" id="occupyReserved">Ocupar mesa</button>`:``}</div>`);
  $("tableNewOrder")?.addEventListener("click",()=>openOrderModal(id));
  $("occupyReserved")?.addEventListener("click",async()=>{const {error}=await state.supabase.from("mesas").update({estado:"ocupada"}).eq("id",id);if(error)toast(error.message);else{closeModal();await loadAll();}});
  $("reserveTable")?.addEventListener("click",async()=>{const {error}=await state.supabase.from("mesas").update({estado:"reservada"}).eq("id",id);if(error)toast(error.message);else{closeModal();await loadAll();toast("Mesa reservada.");}});
  $("freeTable")?.addEventListener("click",async()=>{const {error}=await state.supabase.from("mesas").update({estado:"disponible"}).eq("id",id);if(error)toast(error.message);else{closeModal();await loadAll();toast("Reserva liberada.");}});
}
function renderOrders(){
  const filter=$("orderFilter").value,search=$("orderSearch").value.toLowerCase();
  const rows=state.orders.filter(o=>(filter==="all"||o.estado===filter)&&(`${o.id} ${o.mesas?.numero||""}`).toLowerCase().includes(search));
  $("ordersTable").innerHTML=rows.map(o=>`<tr><td><strong>#${o.id.slice(0,8)}</strong></td><td>Mesa ${o.mesas?.numero||"—"}</td><td>${dateText(o.created_at)}</td><td>${(o.detalle_pedidos||[]).reduce((s,d)=>s+Number(d.cantidad),0)} unidades</td><td><strong>${money(o.total)}</strong></td><td><span class="status ${o.estado}">${statusText(o.estado)}</span></td><td>${orderAction(o)}</td></tr>`).join("")||'<tr><td colspan="7" class="empty-state">No se encontraron pedidos.</td></tr>';
  document.querySelectorAll("[data-order-action]").forEach(b=>b.addEventListener("click",()=>updateOrderStatus(b.dataset.orderAction,b.dataset.id)));
  document.querySelectorAll("[data-edit-order]").forEach(b=>b.addEventListener("click",()=>editOrder(b.dataset.editOrder)));
}
async function editOrder(orderId){
  const order=state.orders.find(o=>o.id===orderId);if(!order||order.estado!=="pendiente")return toast("Solo puedes editar pedidos pendientes.");
  const items=(order.detalle_pedidos||[]).map(d=>({productId:d.producto_id,cantidad:d.cantidad}));
  const options=state.products.map(p=>`<option value="${p.id}">${esc(p.nombre)} · ${money(p.precio)}</option>`).join("");
  openModal("Editar pedido","MODIFICAR COMANDA",`<p class="muted">Pedido #${order.id.slice(0,8)} · Mesa ${order.mesas?.numero||"—"}</p><div id="orderLines" class="order-lines"></div><button id="addOrderLine" class="btn btn-secondary" type="button">＋ Añadir producto</button><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Cancelar</button><button id="saveOrderEdit" class="btn btn-primary">Guardar cambios</button></div>`);
  const addLine=(productId="",qty=1)=>{const div=document.createElement("div");div.className="order-line";div.innerHTML=`<select class="line-product">${options}</select><input class="line-qty" type="number" min="1" step="1" value="${qty}"><button type="button" class="close-modal remove-line">×</button>`;if(productId)div.querySelector("select").value=productId;div.querySelector(".remove-line").addEventListener("click",()=>div.remove());$("orderLines").appendChild(div);};
  items.forEach(i=>addLine(i.productId,i.cantidad));$("addOrderLine").addEventListener("click",()=>addLine());
  $("saveOrderEdit").addEventListener("click",async()=>{const updated=[...document.querySelectorAll(".order-line")].map(x=>({producto_id:x.querySelector("select").value,cantidad:Number(x.querySelector("input").value)})).filter(x=>x.producto_id&&x.cantidad>0);if(!updated.length)return toast("El pedido debe tener productos.");const {error}=await state.supabase.rpc("actualizar_pedido",{p_pedido_id:orderId,p_items:updated});if(error)return toast(error.message);closeModal();toast("Pedido actualizado.");await loadAll();});
}
function orderAction(o){if(o.estado==="pendiente")return `<button class="table-action" data-edit-order="${o.id}">Editar</button> <button class="table-action" data-order-action="preparando" data-id="${o.id}">Enviar a cocina</button>`;if(o.estado==="preparando")return `<button class="table-action" data-order-action="preparado" data-id="${o.id}">Marcar preparado</button>`;if(o.estado==="preparado")return `<button class="table-action" data-order-action="entregado" data-id="${o.id}">Entregar / cerrar</button>`;return "—";}
async function updateOrderStatus(id,status){
  if(status==="preparado"){
    const {error}=await state.supabase.rpc("preparar_pedido",{p_pedido_id:id});
    if(error){toast("No se pudo preparar: "+error.message);return;}
  }else{
    const {error}=await state.supabase.from("pedidos").update({estado:status}).eq("id",id);
    if(error){toast(error.message);return;}
    if(status==="entregado"){
      const order=state.orders.find(o=>o.id===id);
      if(order?.mesa_id){const other=state.orders.some(o=>o.id!==id&&o.mesa_id===order.mesa_id&&!["entregado","cancelado"].includes(o.estado));if(!other)await state.supabase.from("mesas").update({estado:"disponible"}).eq("id",order.mesa_id);}
    }
  }
  toast("Estado del pedido actualizado.");await loadAll();
}
function openOrderModal(preselectedTable=null,preselectedItems=[]){
  const available=state.tables.filter(t=>t.estado==="disponible"||t.id===preselectedTable);
  const options=available.map(t=>`<option value="${t.id}" ${t.id===preselectedTable?"selected":""}>Mesa ${t.numero}</option>`).join("");
  if(!available.length)return toast("No hay mesas disponibles.");
  const productOptions=state.products.map(p=>`<option value="${p.id}">${esc(p.nombre)} · ${money(p.precio)}</option>`).join("");
  openModal("Registrar pedido","NUEVA COMANDA",`<label>Mesa<select id="orderMesa">${options}</select></label><div class="field-label">Productos y cantidades</div><div id="orderLines" class="order-lines"></div><button id="addOrderLine" class="btn btn-secondary" type="button">＋ Añadir producto</button><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Cancelar</button><button id="saveOrder" class="btn btn-primary">Registrar pedido</button></div>`);
  const addLine=(productId="",qty=1)=>{const div=document.createElement("div");div.className="order-line";div.innerHTML=`<select class="line-product">${productOptions}</select><input class="line-qty" type="number" min="1" step="1" value="${qty}">`;if(productId)div.querySelector("select").value=productId;$("orderLines").appendChild(div);};
  if(preselectedItems.length)preselectedItems.forEach(i=>addLine(i.productId,i.cantidad));else addLine();
  $("addOrderLine").addEventListener("click",()=>addLine());
  $("saveOrder").addEventListener("click",async()=>{
    const mesaId=$("orderMesa").value;
    const items=[...document.querySelectorAll(".order-line")].map(x=>({producto_id:x.querySelector("select").value,cantidad:Number(x.querySelector("input").value)})).filter(x=>x.producto_id&&x.cantidad>0);
    if(!items.length)return toast("Agrega al menos un producto.");
    const {data,error}=await state.supabase.rpc("registrar_pedido",{p_mesa_id:mesaId,p_items:items});
    if(error){toast("No se pudo registrar: "+error.message);return;}
    closeModal();toast("Pedido registrado correctamente.");await loadAll();navigate("pedidos");
  });
}
function renderInventory(){
  const q=$("ingredientSearch").value.toLowerCase(),f=$("ingredientFilter").value;
  const filtered=state.ingredients.filter(i=>i.nombre.toLowerCase().includes(q)).filter(i=>f==="all"||(f==="low"?Number(i.stock_actual)<=Number(i.stock_minimo):Number(i.stock_actual)>Number(i.stock_minimo)));
  $("invTotal").textContent=state.ingredients.length;$("invLow").textContent=state.ingredients.filter(i=>Number(i.stock_actual)<=Number(i.stock_minimo)).length;$("invUnits").textContent="Unidades";
  $("inventoryTable").innerHTML=filtered.map(i=>`<tr><td><strong>${esc(i.nombre)}</strong></td><td>${esc(i.categoria||"General")}</td><td>${Number(i.stock_actual).toFixed(2)} ${esc(i.unidad)}</td><td>${Number(i.stock_minimo).toFixed(2)} ${esc(i.unidad)}</td><td><span class="status ${Number(i.stock_actual)<=Number(i.stock_minimo)?"pendiente":"preparado"}">${Number(i.stock_actual)<=Number(i.stock_minimo)?"Reponer":"Suficiente"}</span></td><td><button class="table-action" data-restock="${i.id}">＋ Ingresar stock</button></td></tr>`).join("")||'<tr><td colspan="6" class="empty-state">No hay ingredientes registrados.</td></tr>';
  document.querySelectorAll("[data-restock]").forEach(b=>b.addEventListener("click",()=>openRestockModal(b.dataset.restock)));
}
function openIngredientModal(){
  openModal("Registrar ingrediente","INVENTARIO",`<form id="ingredientForm"><label>Nombre<input name="nombre" required placeholder="Ej. Carne de res"></label><label>Categoría<input name="categoria" placeholder="Carnes, verduras, abarrotes..."></label><div class="order-line"><label>Stock inicial<input name="stock_actual" type="number" min="0" step="0.01" value="0" required></label><label>Stock mínimo<input name="stock_minimo" type="number" min="0" step="0.01" value="1" required></label></div><label>Unidad de medida<select name="unidad"><option>kg</option><option>g</option><option>litro</option><option>ml</option><option>unidad</option></select></label><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary">Guardar ingrediente</button></div></form>`);
  $("ingredientForm").addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.stock_actual=Number(d.stock_actual);d.stock_minimo=Number(d.stock_minimo);const {error}=await state.supabase.from("ingredientes").insert(d);if(error)toast(error.message);else{closeModal();toast("Ingrediente registrado.");await loadAll();}});
}
function openRestockModal(id){
  const ing=state.ingredients.find(i=>i.id===id);if(!ing)return;
  openModal("Ingreso de inventario","MOVIMIENTO DE ENTRADA",`<p class="muted">${esc(ing.nombre)} · Stock actual: ${ing.stock_actual} ${esc(ing.unidad)}</p><form id="restockForm"><label>Cantidad a ingresar<input name="cantidad" type="number" min="0.01" step="0.01" required placeholder="Ej. 5"></label><label>Observación<input name="observacion" placeholder="Compra a proveedor, ajuste..."></label><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary">Registrar ingreso</button></div></form>`);
  $("restockForm").addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const {error}=await state.supabase.rpc("registrar_entrada_inventario",{p_ingrediente_id:id,p_cantidad:Number(d.cantidad),p_observacion:d.observacion||"Ingreso manual"});if(error)toast(error.message);else{closeModal();toast("Stock actualizado.");await loadAll();}});
}
function renderMenu(){
  $("menuGrid").innerHTML=state.products.map(p=>`<article class="menu-card"><div class="menu-card-top"><span class="food-icon">🍽️</span><span class="menu-category">${esc(p.categorias?.nombre||"Menú")}</span></div><h3>${esc(p.nombre)}</h3><p>${esc(p.descripcion||"Especialidad de la casa")}</p><div class="menu-price">${money(p.precio)}</div></article>`).join("")||'<div class="empty-state">No hay productos en el menú.</div>';
}
function openProductModal(){
  openModal("Agregar producto","MENÚ DEL RESTAURANTE",`<form id="productForm"><label>Nombre del plato o bebida<input name="nombre" required placeholder="Ej. Lomo saltado"></label><label>Descripción<input name="descripcion" placeholder="Descripción breve"></label><div class="order-line"><label>Precio (S/)<input name="precio" type="number" min="0.01" step="0.01" required></label><label>Categoría<select name="categoria_id">${(window.categories||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></label></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary">Guardar producto</button></div></form>`);
  $("productForm").addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.precio=Number(d.precio);const {error}=await state.supabase.from("productos").insert(d);if(error)toast(error.message);else{closeModal();toast("Producto agregado.");await loadAll();}});
}
function fillVoiceTables(){$("voiceTable").innerHTML=state.tables.filter(t=>t.estado==="disponible").map(t=>`<option value="${t.id}">Mesa ${t.numero}</option>`).join("");}
let recognition=null;
function startRecognition(){
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Speech){toast("Tu navegador no permite reconocimiento de voz. Puedes escribir el pedido.");return;}
  if(recognition){recognition.stop();recognition=null;return;}
  recognition=new Speech();recognition.lang="es-PE";recognition.interimResults=false;recognition.maxAlternatives=1;
  $("micBtn").classList.add("recording");$("voiceStatus").textContent="Escuchando… habla ahora";
  recognition.onresult=e=>{$("transcript").value=e.results[0][0].transcript;$("voiceStatus").textContent="Transcripción capturada. Revísala y pulsa interpretar.";};
  recognition.onerror=e=>{$("voiceStatus").textContent="No se pudo capturar la voz: "+e.error;};
  recognition.onend=()=>{$("micBtn").classList.remove("recording");recognition=null;};
  recognition.start();
}
async function interpretVoice(){
  const transcript=$("transcript").value.trim();if(!transcript)return toast("Dicta o escribe el pedido primero.");
  $("interpretBtn").disabled=true;$("interpretBtn").textContent="Interpretando…";
  try{
    if(!state.supabase||!state.session)throw new Error("Inicia sesión para interpretar pedidos.");
    const {data,error}=await state.supabase.functions.invoke("interpret-order",{body:{transcript}});
    if(error){
      let message=error.message;
      if(error.context?.json){try{message=(await error.context.json()).error||message;}catch{}}
      throw new Error(message||"No se pudo interpretar el pedido. Intenta nuevamente.");
    }
    if(data?.error)throw new Error(data.error);
    state.voiceItems=(data.items||[]).map(i=>({...i,product:state.products.find(p=>p.nombre.toLowerCase()===String(i.producto).toLowerCase())||null}));
    renderVoiceResult(data.mensaje||"Revisa los productos detectados.");
  }catch(e){state.voiceItems=[];renderVoiceResult("No se interpretó el pedido. Corrige el texto e intenta nuevamente.");toast(e.message);}finally{$("interpretBtn").disabled=false;$("interpretBtn").textContent="✦ Interpretar con IA";}
}
function renderVoiceResult(message){
  const valid=state.voiceItems.filter(i=>i.product);
  $("voiceResult").innerHTML=`<p class="muted">${esc(message)}</p>`+(state.voiceItems.length?state.voiceItems.map((i,index)=>`<div class="interpreted-row"><span>${i.product?esc(i.product.nombre):`<b class="warning-text">No reconocido: ${esc(i.producto||"producto")}</b>`}<small style="display:block;color:#9aa39c">${i.product?money(i.product.precio):"Revisar menú"}</small></span><input type="number" min="1" value="${i.cantidad}" data-voice-qty="${index}"></div>`).join(""):'<p class="empty-state">No se detectaron productos. Intenta dictar nuevamente.</p>');
  $("confirmVoiceBtn").disabled=!valid.length||!$("voiceTable").value;
}
async function confirmVoiceOrder(){
  const table=$("voiceTable").value;if(!table)return toast("Selecciona una mesa disponible.");
  const items=state.voiceItems.filter(i=>i.product).map((i,index)=>({producto_id:i.product.id,cantidad:Number(document.querySelector(`[data-voice-qty="${index}"]`)?.value||i.cantidad)}));
  if(!items.length)return toast("No hay productos válidos para confirmar.");
  const {error}=await state.supabase.rpc("registrar_pedido",{p_mesa_id:table,p_items:items});
  if(error){toast(error.message);return;}
  state.voiceItems=[];$("transcript").value="";$("voiceResult").innerHTML='<div class="empty-state">Pedido confirmado y registrado correctamente.</div>';$("confirmVoiceBtn").disabled=true;toast("Pedido por voz registrado.");await loadAll();navigate("pedidos");
}
function openModal(title,eyebrow,body){$("modalTitle").textContent=title;$("modalEyebrow").textContent=eyebrow;$("modalBody").innerHTML=body;$("modal").classList.remove("hidden");}
function closeModal(){$("modal").classList.add("hidden");}
document.addEventListener("DOMContentLoaded",init);
