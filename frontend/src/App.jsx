import { useEffect, useMemo, useState } from "react";
import "./style.css";

const API = "/api/admin";
const plans = [
  ["trial_week", "Тест 7 дней"],
  ["trial", "Trial"],
  ["basic", "Basic"],
  ["pro", "Pro"],
  ["enterprise", "Enterprise"],
  ["postpaid_custom", "Индивидуальная постоплата"],
];
const fmt = (v) => `${Number(v || 0).toLocaleString("ru-RU")} ₽`;
const date = (v) => (v ? new Date(v).toLocaleString("ru-RU") : "—");

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.message || `HTTP ${res.status}`);
  return body;
}

function useOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try { setData(await api("/overview")); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return { data, loading, error, load };
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Modal({ title, onClose, children }) {
  return <div className="modalBack" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal">
      <div className="modalHead"><b>{title}</b><button onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>;
}

function Empty({ title, text }) {
  return <div className="empty"><b>{title}</b><span>{text}</span></div>;
}

function App() {
  const { data, loading, error, load } = useOverview();
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const shopsById = useMemo(() => Object.fromEntries((data?.shops || []).map(s => [s.id, s])), [data]);
  const tenantsById = useMemo(() => Object.fromEntries((data?.tenants || []).map(t => [t.id, t])), [data]);

  const submit = async (path, payload) => {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: JSON.stringify(payload) });
      setToast("Готово");
      setModal(null);
      await load();
    } catch (e) {
      setToast(e.message);
    } finally { setBusy(false); }
  };

  const action = async (path) => {
    setBusy(true);
    try { await api(path, { method: "POST" }); setToast("Готово"); await load(); }
    catch (e) { setToast(e.message); }
    finally { setBusy(false); }
  };

  return <div className="app">
    <aside>
      <div className="brand"><div className="logo">BF</div><div><b>BotFactory</b><span>production panel v2.2</span></div></div>
      {[
        ["dashboard", "📊 Дашборд"], ["tenants", "👥 Пользователи"], ["shops", "🤖 Магазины"],
        ["products", "🛍 Товары"], ["cards", "💳 Карты"], ["tokens", "🔁 Токены"],
        ["members", "👮 Кассиры"], ["orders", "📦 Заказы"], ["postpaid", "🧾 Постоплата"],
      ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={tab === id ? "active" : ""}>{label}</button>)}
      <button className="ghost" onClick={load}>🔄 Обновить</button>
    </aside>

    <main>
      <header><div><p>Система без демо-данных</p><h1>{title(tab)}</h1></div><button onClick={() => setModal(tab)}>{buttonTitle(tab)}</button></header>
      {loading && <Empty title="Загрузка" text="Читаю реальные данные из PostgreSQL." />}
      {error && <Empty title="Ошибка API" text={error} />}
      {!loading && !error && data && <>
        {tab === "dashboard" && <Dashboard data={data} />}
        {tab === "tenants" && <Tenants rows={data.tenants} onTopup={(id)=>setModal({type:"topup", id})} onPlan={(id)=>setModal({type:"plan", id})} onBlock={(id)=>action(`/tenants/${id}/toggle-block`)} />}
        {tab === "shops" && <Shops rows={data.shops} tenantsById={tenantsById} />}
        {tab === "products" && <Products rows={data.products} shopsById={shopsById} />}
        {tab === "cards" && <Cards rows={data.cards} shopsById={shopsById} />}
        {tab === "tokens" && <Tokens rows={data.tokens} shopsById={shopsById} onActivate={(id)=>action(`/tokens/${id}/activate`)} />}
        {tab === "members" && <Members rows={data.members} shopsById={shopsById} />}
        {tab === "orders" && <Orders rows={data.orders} shopsById={shopsById} onConfirm={(id)=>action(`/orders/${id}/confirm`)} onReject={(id)=>action(`/orders/${id}/reject`)} />}
        {tab === "postpaid" && <Postpaid rows={data.tenants.filter(t=>t.plan==="postpaid_custom")} />}
      </>}
    </main>

    {modal && <CreateModal modal={modal} data={data} busy={busy} onClose={()=>setModal(null)} onSubmit={submit} tenantsById={tenantsById} />}
    {toast && <div className="toast" onAnimationEnd={() => setToast("")}>{toast}</div>}
  </div>;
}

function title(tab) {
  return ({dashboard:"Дашборд", tenants:"Пользователи", shops:"Магазины", products:"Товары", cards:"Карты", tokens:"Токены бота магазина", members:"Кассиры", orders:"Заказы", postpaid:"Индивидуальная постоплата"})[tab] || "BotFactory";
}
function buttonTitle(tab) {
  return ({tenants:"+ Пользователь", shops:"+ Магазин", products:"+ Товар", cards:"+ Карта", tokens:"+ Токен", members:"+ Кассир"})[tab] || "Обновить";
}

function Dashboard({ data }) {
  const s = data.stats;
  return <>
    <div className="grid stats">
      <Card k="Пользователи" v={s.tenants} /> <Card k="Магазины" v={s.shops} /> <Card k="Товары" v={s.products} /> <Card k="Заказы" v={s.orders} />
      <Card k="Ожидают проверки" v={s.pending_orders} warn /> <Card k="Оборот" v={fmt(s.turnover)} /> <Card k="Комиссия" v={fmt(s.commission)} />
    </div>
    <section><h2>Состояние</h2>{!data.tenants.length ? <Empty title="Платформа чистая" text="Демо-данные удалены. Создайте пользователя, магазин, карту, товар и токен бота магазина."/> : <Tenants rows={data.tenants.slice(0,5)} compact />}</section>
  </>;
}
function Card({ k, v, warn }) { return <div className={`card ${warn ? "warn" : ""}`}><span>{k}</span><b>{v}</b></div>; }

function Table({ head, children }) { return <div className="tableWrap"><table><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Badge({ children, tone="" }) { return <span className={`badge ${tone}`}>{children}</span>; }

function Tenants({ rows, onTopup, onPlan, onBlock, compact }) {
  if (!rows.length) return <Empty title="Пользователей нет" text="Создайте первого владельца магазина." />;
  return <Table head={["ID", "Имя", "Тариф", "Баланс", "Оборот", "Статус", compact ? "" : "Действия"]}>{rows.map(t => <tr key={t.id}>
    <td>#{t.id}</td><td><b>{t.name}</b><small>{t.email}<br/>TG: {t.telegram_id || "—"}</small></td>
    <td><Badge tone={t.plan === "postpaid_custom" ? "purple" : ""}>{plans.find(p=>p[0]===t.plan)?.[1] || t.plan}</Badge>{t.trial_ends_at && <small>до {date(t.trial_ends_at)}</small>}</td>
    <td>{fmt(t.balance)}<small>порог {fmt(t.alert_threshold)}</small></td><td>{fmt(t.total_revenue)}<small>комиссия {fmt(t.total_commission)}</small></td>
    <td>{t.is_blocked ? <Badge tone="red">блок</Badge> : <Badge tone="green">активен</Badge>}</td>
    {!compact && <td className="actions"><button onClick={()=>onTopup(t.id)}>Пополнить</button><button onClick={()=>onPlan(t.id)}>Тариф</button><button onClick={()=>onBlock(t.id)}>{t.is_blocked ? "Разблок" : "Блок"}</button></td>}
  </tr>)}</Table>;
}
function Shops({ rows, tenantsById }) {
  if (!rows.length) return <Empty title="Магазинов нет" text="Создайте магазин и укажите токен отдельного бота управления." />;
  return <Table head={["ID", "Магазин", "Владелец", "Control bot", "Активный shop bot", "Статистика"]}>{rows.map(s => <tr key={s.id}>
    <td>#{s.id}</td><td><b>{s.name}</b><small>{s.is_active ? "активен" : "выключен"}</small></td><td>{tenantsById[s.tenant_id]?.name || s.tenant_id}</td><td>{s.ctrl_bot_username || "токен задан"}</td><td>{s.active_shop_bot || "—"}</td><td>{s.products_count} товаров · {s.orders_count} заказов · {fmt(s.revenue)}</td>
  </tr>)}</Table>;
}
function Products({ rows, shopsById }) { if (!rows.length) return <Empty title="Товаров нет" text="Добавьте товар с описанием и контентом для автовыдачи."/>; return <Table head={["ID", "Товар", "Магазин", "Цена", "Остаток", "Статус"]}>{rows.map(p=><tr key={p.id}><td>#{p.id}</td><td><b>{p.name}</b><small>{p.category}<br/>{p.description}</small></td><td>{shopsById[p.shop_id]?.name || p.shop_id}</td><td>{fmt(p.price)}</td><td>{p.stock}<small>продано {p.sold}</small></td><td>{p.is_active?<Badge tone="green">активен</Badge>:<Badge tone="red">архив</Badge>}</td></tr>)}</Table>; }
function Cards({ rows, shopsById }) { if (!rows.length) return <Empty title="Карт нет" text="Добавьте реквизиты владельца магазина. Покупателю будет выдаваться случайная активная карта."/>; return <Table head={["ID", "Карта", "Магазин", "Статистика", "Статус"]}>{rows.map(c=><tr key={c.id}><td>#{c.id}</td><td><b>{c.bank}</b><small>{c.number}<br/>{c.holder}{c.phone && ` · ${c.phone}`}</small></td><td>{shopsById[c.shop_id]?.name || c.shop_id}</td><td>{c.orders_count} заказов<br/>{fmt(c.received_total)}</td><td>{c.is_active?<Badge tone="green">активна</Badge>:<Badge>выкл</Badge>}</td></tr>)}</Table>; }
function Tokens({ rows, shopsById, onActivate }) { if (!rows.length) return <Empty title="Токенов магазина нет" text="Добавьте хотя бы один токен покупательского бота магазина."/>; return <Table head={["ID", "Bot", "Магазин", "Заметка", "Статус", "Действие"]}>{rows.map(t=><tr key={t.id}><td>#{t.id}</td><td><b>{t.username || t.token_masked}</b><small>{t.token_masked}</small></td><td>{shopsById[t.shop_id]?.name || t.shop_id}</td><td>{t.note}</td><td>{t.is_active?<Badge tone="green">активный</Badge>:<Badge>резерв</Badge>}</td><td>{!t.is_active && <button onClick={()=>onActivate(t.id)}>Переключить</button>}</td></tr>)}</Table>; }
function Members({ rows, shopsById }) { if (!rows.length) return <Empty title="Кассиров нет" text="Добавьте Telegram ID модераторов, которые смогут подтверждать оплаты в боте управления."/>; return <Table head={["ID", "Сотрудник", "Магазин", "Роль"]}>{rows.map(m=><tr key={m.id}><td>#{m.id}</td><td><b>{m.name}</b><small>@{m.username || "—"} · TG {m.telegram_id}</small></td><td>{shopsById[m.shop_id]?.name || m.shop_id}</td><td><Badge>{m.role}</Badge></td></tr>)}</Table>; }
function Orders({ rows, shopsById, onConfirm, onReject }) { if (!rows.length) return <Empty title="Заказов нет" text="Заказы появятся после покупки через клиентского Telegram-бота."/>; return <Table head={["ID", "Магазин", "Покупатель", "Сумма", "Статус", "Дата", "Действия"]}>{rows.map(o=><tr key={o.id}><td>#{o.id}</td><td>{shopsById[o.shop_id]?.name || o.shop_id}</td><td>{o.buyer_username || o.buyer_telegram_id}</td><td>{fmt(o.amount)}<small>комиссия {fmt(o.commission)}</small></td><td><Badge tone={o.status==="completed"?"green":o.status==="rejected"?"red":"yellow"}>{o.status}</Badge></td><td>{date(o.created_at)}</td><td className="actions">{["pending","confirming"].includes(o.status)&&<><button onClick={()=>onConfirm(o.id)}>Подтвердить</button><button onClick={()=>onReject(o.id)}>Отклонить</button></>}</td></tr>)}</Table>; }
function Postpaid({ rows }) { if (!rows.length) return <Empty title="Постоплатных тарифов нет" text="Назначьте индивидуальную постоплату пользователю через кнопку 'Тариф'."/>; return <Table head={["Пользователь", "Процент", "Оплата", "Прошлый месяц", "К оплате"]}>{rows.map(t=><tr key={t.id}><td><b>{t.name}</b><small>{t.email}</small></td><td>{t.postpaid_commission_percent}%</td><td>до {t.postpaid_due_day} числа<small>{date(t.postpaid_due_date)}</small></td><td>{fmt(t.postpaid_previous_month_revenue)}</td><td>{fmt(t.postpaid_previous_month_due)}</td></tr>)}</Table>; }

function CreateModal({ modal, data, busy, onClose, onSubmit, tenantsById }) {
  const type = typeof modal === "string" ? modal : modal.type;
  const id = typeof modal === "object" ? modal.id : null;
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const shops = data?.shops || [];
  const tenants = data?.tenants || [];
  const post = (path, payload) => onSubmit(path, payload);

  if (type === "dashboard" || type === "orders" || type === "postpaid") return <Modal title="Обновление" onClose={onClose}><p>Используйте кнопку «Обновить» в меню.</p></Modal>;
  if (type === "topup") return <Modal title={`Пополнение: ${tenantsById[id]?.name || id}`} onClose={onClose}><Form onSubmit={()=>post(`/tenants/${id}/topup`, { amount:Number(form.amount), note:form.note || "Пополнение через веб" })} busy={busy}><Field label="Сумма"><input onChange={e=>set("amount", e.target.value)} placeholder="1000"/></Field><Field label="Комментарий"><input onChange={e=>set("note", e.target.value)} placeholder="Оплата комиссии"/></Field></Form></Modal>;
  if (type === "plan") return <Modal title={`Тариф: ${tenantsById[id]?.name || id}`} onClose={onClose}><Form onSubmit={()=>post(`/tenants/${id}/plan`, { plan:form.plan || "trial_week", postpaid_commission_percent:Number(form.percent || 5), postpaid_due_day:Number(form.due || 5) })} busy={busy}><Field label="Тариф"><select onChange={e=>set("plan", e.target.value)}>{plans.map(p=><option key={p[0]} value={p[0]}>{p[1]}</option>)}</select></Field><Field label="% для постоплаты"><input onChange={e=>set("percent", e.target.value)} placeholder="5"/></Field><Field label="День оплаты"><input onChange={e=>set("due", e.target.value)} placeholder="5"/></Field></Form></Modal>;
  if (type === "tenants") return <Modal title="Новый пользователь" onClose={onClose}><Form busy={busy} onSubmit={()=>post("/tenants", { name:form.name, email:form.email, telegram_id:num(form.telegram_id), balance:Number(form.balance || 0), alert_threshold:Number(form.alert_threshold || 200), plan:form.plan || "trial_week" })}><Field label="Имя"><input onChange={e=>set("name",e.target.value)} /></Field><Field label="Email"><input onChange={e=>set("email",e.target.value)} /></Field><Field label="Telegram ID"><input onChange={e=>set("telegram_id",e.target.value)} /></Field><Field label="Баланс"><input onChange={e=>set("balance",e.target.value)} placeholder="0"/></Field><Field label="Порог уведомления"><input onChange={e=>set("alert_threshold",e.target.value)} placeholder="200"/></Field><Field label="Тариф"><select onChange={e=>set("plan",e.target.value)}>{plans.map(p=><option key={p[0]} value={p[0]}>{p[1]}</option>)}</select></Field></Form></Modal>;
  if (type === "shops") return <Modal title="Новый магазин" onClose={onClose}><Form busy={busy} onSubmit={()=>post("/shops", { tenant_id:Number(form.tenant_id), name:form.name, ctrl_bot_token:form.ctrl_bot_token, ctrl_bot_username:form.ctrl_bot_username || "", welcome_msg:form.welcome_msg || "Добро пожаловать!" })}><SelectTenant tenants={tenants} set={set}/><Field label="Название магазина"><input onChange={e=>set("name",e.target.value)} /></Field><Field label="Токен бота управления"><input onChange={e=>set("ctrl_bot_token",e.target.value)} /></Field><Field label="Username бота управления"><input onChange={e=>set("ctrl_bot_username",e.target.value)} placeholder="@my_ctrl_bot"/></Field><Field label="Приветствие"><textarea onChange={e=>set("welcome_msg",e.target.value)} /></Field></Form></Modal>;
  if (type === "products") return <Modal title="Новый товар" onClose={onClose}><Form busy={busy} onSubmit={()=>post("/products", { shop_id:Number(form.shop_id), name:form.name, price:Number(form.price), category:form.category || "Общее", description:form.description || "", content:form.content || "", photo_url:form.photo_url || null, stock:Number(form.stock || 1) })}><SelectShop shops={shops} set={set}/><Field label="Название"><input onChange={e=>set("name",e.target.value)} /></Field><Field label="Цена"><input onChange={e=>set("price",e.target.value)} /></Field><Field label="Категория"><input onChange={e=>set("category",e.target.value)} /></Field><Field label="Описание"><textarea onChange={e=>set("description",e.target.value)} /></Field><Field label="Контент для автовыдачи"><textarea onChange={e=>set("content",e.target.value)} /></Field><Field label="Фото URL/file_id"><input onChange={e=>set("photo_url",e.target.value)} /></Field><Field label="Остаток"><input onChange={e=>set("stock",e.target.value)} placeholder="1"/></Field></Form></Modal>;
  if (type === "cards") return <Modal title="Новая карта" onClose={onClose}><Form busy={busy} onSubmit={()=>post("/cards", { shop_id:Number(form.shop_id), bank:form.bank, number:form.number, holder:form.holder, phone:form.phone || "" })}><SelectShop shops={shops} set={set}/><Field label="Банк"><input onChange={e=>set("bank",e.target.value)} /></Field><Field label="Номер карты"><input onChange={e=>set("number",e.target.value)} /></Field><Field label="Держатель"><input onChange={e=>set("holder",e.target.value)} /></Field><Field label="Телефон СБП"><input onChange={e=>set("phone",e.target.value)} /></Field></Form></Modal>;
  if (type === "tokens") return <Modal title="Токен покупательского бота" onClose={onClose}><Form busy={busy} onSubmit={()=>post("/tokens", { shop_id:Number(form.shop_id), token:form.token, username:form.username || "", note:form.note || "Основной", is_active:form.is_active !== "false" })}><SelectShop shops={shops} set={set}/><Field label="Токен"><input onChange={e=>set("token",e.target.value)} /></Field><Field label="Username"><input onChange={e=>set("username",e.target.value)} placeholder="@shop_bot"/></Field><Field label="Заметка"><input onChange={e=>set("note",e.target.value)} /></Field><Field label="Активировать сразу"><select onChange={e=>set("is_active",e.target.value)}><option value="true">Да</option><option value="false">Нет, резерв</option></select></Field></Form></Modal>;
  if (type === "members") return <Modal title="Новый кассир" onClose={onClose}><Form busy={busy} onSubmit={()=>post("/members", { shop_id:Number(form.shop_id), telegram_id:Number(form.telegram_id), username:form.username || "", name:form.name, role:form.role || "moderator" })}><SelectShop shops={shops} set={set}/><Field label="Имя"><input onChange={e=>set("name",e.target.value)} /></Field><Field label="Telegram ID"><input onChange={e=>set("telegram_id",e.target.value)} /></Field><Field label="Username"><input onChange={e=>set("username",e.target.value)} /></Field><Field label="Роль"><select onChange={e=>set("role",e.target.value)}><option value="moderator">moderator / кассир</option><option value="admin">admin</option></select></Field></Form></Modal>;
  return null;
}
function num(v){ return v ? Number(v) : null; }
function SelectTenant({ tenants, set }) { return <Field label="Владелец"><select onChange={e=>set("tenant_id", e.target.value)} defaultValue=""><option value="" disabled>Выберите пользователя</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name} · {t.email}</option>)}</select></Field>; }
function SelectShop({ shops, set }) { return <Field label="Магазин"><select onChange={e=>set("shop_id", e.target.value)} defaultValue=""><option value="" disabled>Выберите магазин</option>{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>; }
function Form({ onSubmit, busy, children }) { return <form className="form" onSubmit={(e)=>{e.preventDefault(); onSubmit();}}>{children}<button disabled={busy} className="primary">{busy ? "Сохраняю..." : "Сохранить"}</button></form>; }

export default App;
