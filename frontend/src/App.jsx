import { useState, useEffect, useCallback } from "react";

// ─── HOOKS ────────────────────────────────────────────────────────────────────
const useMobile = () => {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return w < 768;
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const R = {
  accent:"#4f6ef7", orange:"#f7934f", green:"#4fd98e",
  red:"#f75f4f", yellow:"#f7d64f", cyan:"#4fd9f7",
  purple:"#b04ff7",
  bg:"#07080a", surface:"#0e1014", card:"#13151a",
  border:"#1c1f27", border2:"#252830",
  text:"#e8eaed", muted:"#6b7280",
};

const PLANS = {
  trial_week: { label:"Тест 7 дней", color:"#4fd9f7", maxBots:1,   rate:10, price:0    },
  trial:      { label:"Trial",       color:"#888",    maxBots:1,   rate:10, price:0    },
  basic:      { label:"Basic",       color:"#4ECDC4", maxBots:3,   rate:7,  price:990  },
  pro:        { label:"Pro",         color:"#f7d64f", maxBots:10,  rate:5,  price:2490 },
  enterprise: { label:"Enterprise",  color:"#f7934f", maxBots:999, rate:3,  price:7990 },
  postpaid_custom: { label:"Индивидуал", color:"#b04ff7", maxBots:999, rate:0, price:0 },
};

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const INIT_TENANT = {
  id:1, name:"Алексей Громов", email:"alex@shop.ru", plan:"pro",
  status:"active", balance:3450, alertThreshold:500,
  totalOrders:142, totalTurnover:284500, totalCommission:14225,
};

// Each shop = one "магазин" with:
//   controlBot  – отдельный бот-оператора (не банится вместе с магазином)
//   tokens      – список токенов shop-бота (один активный, остальные резерв)
const INIT_SHOPS = [
  {
    id:1, name:"ShopBot Alpha", revenue:178000, orders:89, products:12,
    controlBot:{ token:"7100000001:CTRL_BOT_AAA", username:"@shopbot_alpha_ctrl", status:"active" },
    tokens:[
      { id:1, token:"7123456789:AAFxxx", username:"@shopbot_alpha",   active:true,  status:"active",  note:"Основной",  addedAt:"2026-02-01" },
      { id:2, token:"7987654321:BBByyy", username:"@shopbot_alpha_2", active:false, status:"standby", note:"Резервный", addedAt:"2026-04-10" },
    ],
    admins:[{ id:1, name:"Алексей Громов", username:"@alex_gromov", role:"admin" }],
    moderators:[
      { id:2, name:"Сергей Романов", username:"@sergey_mod",   role:"moderator", addedAt:"2026-03-01" },
      { id:3, name:"Анна Белова",    username:"@anna_cashier", role:"moderator", addedAt:"2026-03-15" },
    ],
  },
  {
    id:2, name:"Keys & Codes", revenue:106500, orders:53, products:28,
    controlBot:{ token:"7200000002:CTRL_BOT_BBB", username:"@keys_codes_ctrl", status:"active" },
    tokens:[
      { id:1, token:"7111111111:CCCzzz", username:"@keys_codes_bot", active:true, status:"active", note:"Основной", addedAt:"2026-03-15" },
    ],
    admins:[{ id:1, name:"Алексей Громов", username:"@alex_gromov", role:"admin" }],
    moderators:[
      { id:4, name:"Дмитрий Петров", username:"@dmitry_mod", role:"moderator", addedAt:"2026-04-01" },
    ],
  },
];

const INIT_CARDS = [
  { id:1, shopId:1, bank:"Сбербанк",  number:"4276 **** **** 4521", holder:"ALEKSEY GROMOV", phone:"+7 999 123-45-67", active:true,  orders:34, received:68000 },
  { id:2, shopId:1, bank:"Тинькофф",  number:"5536 **** **** 7832", holder:"ALEKSEY GROMOV", phone:"+7 988 987-65-43", active:true,  orders:28, received:56000 },
  { id:3, shopId:2, bank:"ВТБ",       number:"4272 **** **** 1203", holder:"ALEKSEY GROMOV", phone:"+7 977 555-11-22", active:true,  orders:18, received:36000 },
  { id:4, shopId:1, bank:"Альфа",     number:"5486 **** **** 9944", holder:"MARIA GROMOVA",  phone:"",                 active:false, orders:6,  received:12000 },
];

const INIT_ORDERS = [
  { id:101, shopId:1, shopName:"ShopBot Alpha", product:"VPN Premium 3 мес",  buyer:"@user_alex99",  buyerId:9910001, amount:599,  commission:30, cardId:1, status:"pending",    date:"2026-05-24 14:52", proof:null },
  { id:102, shopId:1, shopName:"ShopBot Alpha", product:"Spotify Premium",     buyer:"@music_lover",  buyerId:9920002, amount:299,  commission:15, cardId:2, status:"confirming", date:"2026-05-24 13:30", proof:"screenshot.jpg" },
  { id:103, shopId:2, shopName:"Keys & Codes",  product:"Windows 11 Pro Key",  buyer:"@techguy_77",   buyerId:9930003, amount:890,  commission:45, cardId:3, status:"completed",  date:"2026-05-24 12:00", proof:"pay_proof.jpg" },
  { id:104, shopId:1, shopName:"ShopBot Alpha", product:"VPN Premium 3 мес",  buyer:"@vpn_user22",   buyerId:9940004, amount:599,  commission:30, cardId:1, status:"completed",  date:"2026-05-23 20:15", proof:"done.jpg" },
  { id:105, shopId:2, shopName:"Keys & Codes",  product:"Office 2024 Key",     buyer:"@office_pro",   buyerId:9950005, amount:1290, commission:65, cardId:3, status:"rejected",   date:"2026-05-23 18:00", proof:"fake.jpg" },
];

const INIT_TX = [
  { id:1, type:"deposit",    amount:+5000, date:"2026-05-20 10:00", note:"Пополнение баланса" },
  { id:2, type:"commission", amount:-30,   date:"2026-05-24 12:00", note:"Комиссия: заказ #101 (599₽ × 5%)" },
  { id:3, type:"commission", amount:-15,   date:"2026-05-24 13:30", note:"Комиссия: заказ #102 (299₽ × 5%)" },
  { id:4, type:"commission", amount:-45,   date:"2026-05-24 12:00", note:"Комиссия: заказ #103 (890₽ × 5%)" },
  { id:5, type:"alert",      amount:0,     date:"2026-05-22 08:00", note:"⚠️ Уведомление: баланс ниже 500₽" },
  { id:6, type:"deposit",    amount:+3000, date:"2026-05-15 14:00", note:"Пополнение баланса" },
];

const MOCK_PLATFORM_TENANTS = [
  { id:1, name:"Алексей Громов",  email:"alex@shop.ru",    plan:"pro",    status:"active",  balance:3450, alertThreshold:500, totalOrders:142, totalTurnover:284500, totalCommission:14225 },
  { id:2, name:"Мария Селезнёва", email:"maria@digital.ru",plan:"basic",  status:"active",  balance:120,  alertThreshold:200, totalOrders:87,  totalTurnover:174000, totalCommission:12180 },
  { id:3, name:"Иван Кузнецов",   email:"ivan@goods.ru",   plan:"pro",    status:"blocked", balance:0,    alertThreshold:300, totalOrders:44,  totalTurnover:98000,  totalCommission:4900  },
  { id:4, name:"Дмитрий Попов",   email:"dm@newshop.ru",   plan:"trial",  status:"active",  balance:75,   alertThreshold:50,  totalOrders:5,   totalTurnover:4500,   totalCommission:450   },
];


// ─── REAL API MAPPING ─────────────────────────────────────────────────────────
const API = "/api/admin";

const EMPTY_TENANT = {
  id:null, name:"Нет владельца", email:"", plan:"trial_week", status:"active",
  balance:0, alertThreshold:200, totalOrders:0, totalTurnover:0, totalCommission:0,
};

async function adminApi(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.message || `HTTP ${res.status}`);
  return body;
}

function mapOverview(data, prevTenantId = null) {
  const rawTenants = data?.tenants || [];
  const rawShops = data?.shops || [];
  const rawTokens = data?.tokens || [];
  const rawMembers = data?.members || [];
  const rawOrders = data?.orders || [];
  const rawCards = data?.cards || [];
  const rawProducts = data?.products || [];
  const rawTx = data?.transactions || [];

  const productById = Object.fromEntries(rawProducts.map(p => [p.id, p]));
  const shopById = Object.fromEntries(rawShops.map(s => [s.id, s]));

  const tenants = rawTenants.map(t => {
    const tenantShopIds = rawShops.filter(s => s.tenant_id === t.id).map(s => s.id);
    const tenantOrders = rawOrders.filter(o => tenantShopIds.includes(o.shop_id));
    return {
      id:t.id, name:t.name || `Пользователь #${t.id}`, email:t.email || "", plan:t.plan || "trial_week",
      status:t.is_blocked ? "blocked" : "active",
      balance:Number(t.balance || 0), alertThreshold:Number(t.alert_threshold || 0),
      totalOrders:tenantOrders.length, totalTurnover:Number(t.total_revenue || 0),
      totalCommission:Number(t.total_commission || 0),
      postpaidDue:Number(t.postpaid_previous_month_due || 0),
      postpaidDueDate:t.postpaid_due_date,
      postpaidPercent:t.postpaid_commission_percent,
    };
  });

  const selectedTenantId = prevTenantId && tenants.some(t => t.id === prevTenantId)
    ? prevTenantId
    : tenants[0]?.id;
  const tenant = tenants.find(t => t.id === selectedTenantId) || EMPTY_TENANT;

  const tenantShops = rawShops.filter(s => !tenant.id || s.tenant_id === tenant.id).map(s => ({
    id:s.id, name:s.name, revenue:Number(s.revenue || 0), orders:Number(s.orders_count || 0), products:Number(s.products_count || 0),
    controlBot:{ token:s.ctrl_bot_token_set ? "set" : "", username:s.ctrl_bot_username || "—", status:s.is_active ? "active" : "disabled" },
    tokens:rawTokens.filter(t => t.shop_id === s.id).map(t => ({
      id:t.id, token:t.token_masked || "", username:t.username || "—", active:!!t.is_active,
      status:t.is_active ? "active" : "standby", note:t.note || "Резервный", addedAt:(t.added_at || "").slice(0,10),
    })),
    admins:[],
    moderators:rawMembers.filter(m => m.shop_id === s.id).map(m => ({
      id:m.id, name:m.name, username:m.username || String(m.telegram_id || ""), role:m.role || "moderator", addedAt:(m.added_at || "").slice(0,10),
    })),
  }));

  const tenantShopIds = tenantShops.map(s => s.id);
  const cards = rawCards.filter(c => tenantShopIds.includes(c.shop_id)).map(c => ({
    id:c.id, shopId:c.shop_id, bank:c.bank, number:c.number, holder:c.holder, phone:c.phone || "",
    active:!!c.is_active, orders:Number(c.orders_count || 0), received:Number(c.received_total || 0),
  }));

  const orders = rawOrders.filter(o => tenantShopIds.includes(o.shop_id) || !tenant.id).map(o => {
    const shop = shopById[o.shop_id];
    const product = productById[o.product_id];
    return {
      id:o.id, shopId:o.shop_id, shopName:shop?.name || `Магазин #${o.shop_id}`,
      product:product?.name || `Товар #${o.product_id || "—"}`, buyer:o.buyer_username || `ID ${o.buyer_telegram_id || "—"}`,
      buyerId:o.buyer_telegram_id || "—", amount:Number(o.amount || 0), commission:Number(o.commission || 0),
      cardId:o.card_id || "—", status:o.status || "pending", date:(o.created_at || "").replace("T", " ").slice(0,16),
      proof:o.proof_file_id ? "чек получен" : null,
    };
  });

  const txs = rawTx.filter(x => !tenant.id || x.tenant_id === tenant.id).map(x => ({
    id:x.id, type:x.type, amount:Number(x.amount || 0),
    date:(x.created_at || "").replace("T", " ").slice(0,16), note:x.note || "",
  }));

  return { tenant, shops:tenantShops, cards, orders, txs, platformTenants:tenants };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════════════════════
const P = {
  dashboard:"M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  shops:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  orders:"M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  cards:"M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  team:"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  settings:"M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  plus:"M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  check:"M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  close:"M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  trash:"M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  eye:"M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  wallet:"M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  alert:"M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  lock:"M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  shuffle:"M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  swap:"M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z",
  key:"M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
  ctrl:"M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
  shield:"M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z",
  users:"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  revenue:"M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z",
  history:"M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  menu:"M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
  back:"M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  bell:"M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
  edit:"M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  topup:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  percent:"M7.5 11C9.43 11 11 9.43 11 7.5S9.43 4 7.5 4 4 5.57 4 7.5 5.57 11 7.5 11zm0-5C8.33 6 9 6.67 9 7.5S8.33 9 7.5 9 6 8.33 6 7.5 6.67 6 7.5 6zM4 18.5L18.5 4l1.5 1.5L5.5 20 4 18.5zm12-2.5c-1.93 0-3.5 1.57-3.5 3.5S14.07 23 16 23s3.5-1.57 3.5-3.5S17.93 16 16 16zm0 5c-.83 0-1.5-.67-1.5-1.5S15.17 18 16 18s1.5.67 1.5 1.5S16.83 21 16 21z",
};

const Ic = ({ n, s=16, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={c||"currentColor"} style={{flexShrink:0}}>
    <path d={P[n]||P.dashboard}/>
  </svg>
);

// ═══════════════════════════════════════════════════════════════════════════════
// ATOMS
// ═══════════════════════════════════════════════════════════════════════════════
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#07080a;color:#e8eaed;-webkit-font-smoothing:antialiased}
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:#111}
  ::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:2px}
  select option{background:#161920}
  input::placeholder,textarea::placeholder{color:#3a3f4a}
  input:focus,textarea:focus,select:focus{outline:none!important;border-color:#4f6ef7!important}
  tr:hover>td{background:#0f1118!important}
  @media(max-width:767px){
    .hide-mobile{display:none!important}
    .mob-full{width:100%!important}
    .mob-stack{flex-direction:column!important}
    .mob-p{padding:16px!important}
    .mob-grid1{grid-template-columns:1fr!important}
    .mob-grid2{grid-template-columns:1fr 1fr!important}
    .mob-fs13{font-size:13px!important}
    .mob-fs22{font-size:22px!important}
  }
`;

const Tag = ({label,color,bg})=>(
  <span style={{background:bg||`${color}18`,color,border:`1px solid ${color}30`,padding:"2px 9px",borderRadius:20,fontSize:11,whiteSpace:"nowrap",fontFamily:"'JetBrains Mono'"}}>{label}</span>
);
const PlanTag = ({plan})=>{const p=PLANS[plan]||PLANS.trial_week;return <Tag label={p.label} color={p.color}/>;};

const Btn = ({children,onClick,v="primary",sm,full,disabled,style:s={}})=>{
  const st={
    primary:{bg:R.accent,color:"#fff",bo:R.accent},
    ghost:{bg:"transparent",color:R.muted,bo:R.border2},
    danger:{bg:`${R.red}15`,color:R.red,bo:`${R.red}40`},
    success:{bg:`${R.green}15`,color:R.green,bo:`${R.green}40`},
    warning:{bg:`${R.yellow}15`,color:R.yellow,bo:`${R.yellow}40`},
    orange:{bg:`${R.orange}15`,color:R.orange,bo:`${R.orange}40`},
    purple:{bg:`${R.purple}15`,color:R.purple,bo:`${R.purple}40`},
    cyan:{bg:`${R.cyan}15`,color:R.cyan,bo:`${R.cyan}40`},
  }[v]||{bg:R.surface,color:R.muted,bo:R.border2};
  return(
    <button onClick={onClick} disabled={disabled} style={{background:st.bg,color:st.color,border:`1px solid ${st.bo}`,borderRadius:8,padding:sm?"6px 11px":"9px 15px",fontSize:sm?11:13,fontFamily:"'JetBrains Mono'",cursor:disabled?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",gap:6,width:full?"100%":"auto",justifyContent:full?"center":"flex-start",opacity:disabled?.5:1,flexShrink:0,...s}}>
      {children}
    </button>
  );
};

const F = ({label,children,style:s={}})=>(
  <div style={{marginBottom:14,...s}}>
    {label&&<label style={{display:"block",fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5,fontFamily:"'JetBrains Mono'"}}>{label}</label>}
    {children}
  </div>
);
const baseInput = {width:"100%",background:R.surface,border:`1px solid ${R.border2}`,borderRadius:8,padding:"9px 12px",color:R.text,fontSize:13,fontFamily:"'JetBrains Mono'"};
const Inp = ({label,...p})=><F label={label}><input {...p} style={{...baseInput,...p.style}}/></F>;
const Sel = ({label,children,...p})=><F label={label}><select {...p} style={{...baseInput,...p.style}}>{children}</select></F>;
const Txa = ({label,...p})=><F label={label}><textarea {...p} style={{...baseInput,resize:"vertical",minHeight:80,...p.style}}/></F>;

const Card = ({children,style:s={},accent,glow,onClick})=>(
  <div onClick={onClick} style={{background:R.card,border:`1px solid ${glow?glow+"50":R.border}`,borderRadius:12,overflow:"hidden",position:"relative",boxShadow:glow?`0 0 20px ${glow}18`:undefined,cursor:onClick?"pointer":undefined,...s}}>
    {accent&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:accent}}/>}
    {children}
  </div>
);

const Stat = ({label,value,sub,accent=R.accent,icon,glow,mobile})=>(
  <Card accent={accent} glow={glow}>
    <div style={{padding:mobile?"14px 16px":"18px 22px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
        {icon&&<Ic n={icon} s={15} c={accent}/>}
      </div>
      <div className="mob-fs22" style={{fontFamily:"'Syne'",fontWeight:800,fontSize:26,color:R.text,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:R.muted,marginTop:5}}>{sub}</div>}
    </div>
  </Card>
);

const Modal = ({title,onClose,wide,children})=>(
  <div style={{position:"fixed",inset:0,background:"#000000d8",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:R.card,border:`1px solid ${R.border2}`,borderRadius:16,width:"100%",maxWidth:wide?680:500,maxHeight:"92vh",overflow:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${R.border}`,position:"sticky",top:0,background:R.card,zIndex:1}}>
        <span style={{fontFamily:"'Syne'",fontWeight:700,fontSize:16,color:R.text}}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:R.muted,cursor:"pointer",padding:4}}><Ic n="close" s={18}/></button>
      </div>
      <div style={{padding:20}}>{children}</div>
    </div>
  </div>
);

const TH = ({ch})=><th style={{padding:"11px 14px",textAlign:"left",fontSize:10,color:R.muted,fontFamily:"'JetBrains Mono'",textTransform:"uppercase",letterSpacing:"0.05em",borderBottom:`1px solid ${R.border}`,background:R.surface,whiteSpace:"nowrap"}}>{ch}</th>;
const TD = ({children,muted,accent})=><td style={{padding:"12px 14px",fontSize:13,color:muted?R.muted:accent||R.text,fontFamily:"'JetBrains Mono'",borderBottom:`1px solid ${R.border}`}}>{children}</td>;

const OrderBadge = ({status})=>{
  const m={pending:{l:"Ожидает оплаты",c:R.yellow},confirming:{l:"На проверке",c:R.orange},completed:{l:"Выполнен",c:R.green},rejected:{l:"Отклонён",c:R.red}}[status]||{l:status,c:R.muted};
  return <Tag label={m.l} color={m.c}/>;
};

const Toggle = ({on,onChange})=>(
  <div style={{width:40,height:22,background:on?R.accent:R.border2,borderRadius:11,cursor:"pointer",position:"relative",flexShrink:0,transition:"background .2s"}} onClick={()=>onChange(!on)}>
    <div style={{width:16,height:16,background:"#fff",borderRadius:"50%",position:"absolute",top:3,left:on?21:3,transition:"left .2s"}}/>
  </div>
);

const Toast = ({msg,ok=true,onDone})=>{
  useEffect(()=>{const t=setTimeout(onDone,3000);return()=>clearTimeout(t);},[]);
  return <div style={{position:"fixed",bottom:24,right:16,left:16,maxWidth:380,margin:"0 auto",background:ok?R.green:R.red,color:"#000",padding:"12px 18px",borderRadius:10,fontFamily:"'JetBrains Mono'",fontSize:13,zIndex:2000,fontWeight:600,boxShadow:`0 4px 24px ${ok?R.green:R.red}40`}}>{ok?"✓ ":"✗ "}{msg}</div>;
};

const SHead = ({sup,title,action,mobile})=>(
  <div style={{display:"flex",alignItems:mobile?"flex-start":"flex-end",justifyContent:"space-between",marginBottom:mobile?20:28,flexWrap:"wrap",gap:12}}>
    <div>
      <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>{sup}</div>
      <div className="mob-fs22" style={{fontFamily:"'Syne'",fontWeight:800,fontSize:28,color:R.text,lineHeight:1}}>{title}</div>
    </div>
    {action&&<div style={{flexShrink:0}}>{action}</div>}
  </div>
);

// ── Mobile card row (replaces table rows on mobile) ──────────────────────────
const MobCard = ({children,onClick})=>(
  <div onClick={onClick} style={{background:R.surface,border:`1px solid ${R.border}`,borderRadius:10,padding:"12px 14px",marginBottom:10,cursor:onClick?"pointer":undefined}}>
    {children}
  </div>
);

// ── Balance bar (always visible in tenant mode) ───────────────────────────────
const BalBar = ({tenant,onTopup,mobile})=>{
  const empty=tenant.balance<=0, low=tenant.balance>0&&tenant.balance<=tenant.alertThreshold;
  const c=empty?R.red:low?R.yellow:R.green;
  return(
    <div onClick={onTopup} style={{background:`${c}12`,border:`1px solid ${c}35`,borderRadius:10,padding:mobile?"10px 12px":"11px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,marginBottom:mobile?16:20}}>
      <Ic n="wallet" s={18} c={c}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Баланс платформы</div>
        <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:mobile?18:22,color:c,lineHeight:1,marginTop:2}}>{tenant.balance.toLocaleString()} ₽</div>
      </div>
      {empty&&<Tag label="⛔ БОТ ЗАБЛОКИРОВАН" color={R.red}/>}
      {low&&!empty&&<Tag label="⚠️ НИЗКИЙ" color={R.yellow}/>}
      {!empty&&!low&&<span style={{fontSize:11,color:R.accent,flexShrink:0}}>Пополнить →</span>}
    </div>
  );
};

// ─── TOPUP MODAL ──────────────────────────────────────────────────────────────
const TopupModal = ({tenant,onClose,onDone})=>{
  const [amt,setAmt]=useState("");
  const pre=[500,1000,2000,5000];
  return(
    <Modal title="Пополнение баланса" onClose={onClose}>
      <div style={{background:`${R.accent}10`,border:`1px solid ${R.accent}25`,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
        <div style={{fontSize:13,color:R.text}}>Текущий баланс: <strong style={{color:tenant.balance<=0?R.red:R.green}}>{tenant.balance.toLocaleString()} ₽</strong></div>
        <div style={{fontSize:11,color:R.muted,marginTop:4}}>Комиссия {(PLANS[tenant.plan]||PLANS.trial_week).rate}% списывается с каждого выполненного заказа</div>
      </div>
      <F label="Быстрый выбор">
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {pre.map(p=><button key={p} onClick={()=>setAmt(String(p))} style={{background:amt===String(p)?`${R.accent}25`:R.surface,border:`1px solid ${amt===String(p)?R.accent:R.border2}`,color:amt===String(p)?R.accent:R.muted,borderRadius:8,padding:"8px 14px",fontSize:13,fontFamily:"'JetBrains Mono'",cursor:"pointer"}}>{p.toLocaleString()} ₽</button>)}
        </div>
      </F>
      <Inp label="Или сумма вручную (₽)" type="number" placeholder="1000" value={amt} onChange={e=>setAmt(e.target.value)}/>
      <div style={{background:R.surface,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
        <div style={{fontSize:11,color:R.muted,marginBottom:8}}>Реквизиты платформы:</div>
        <div style={{fontSize:13,color:R.text,marginBottom:3}}>🏦 <strong>Тинькофф</strong> · 5536 **** **** 0001</div>
        <div style={{fontSize:13,color:R.text,marginBottom:3}}>👤 ООО «БотФактори»</div>
        <div style={{fontSize:13,color:R.text,marginBottom:8}}>📝 Назначение: <strong style={{color:R.cyan}}>Пополнение #{tenant.id} BotFactory</strong></div>
        <div style={{fontSize:11,color:R.yellow}}>⚠️ Обязательно укажите назначение платежа</div>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn v="ghost" onClick={onClose}>Отмена</Btn>
        <Btn onClick={()=>{onDone(Number(amt)||0);onClose();}} disabled={!amt||Number(amt)<100}><Ic n="topup" s={14}/> Оплатил</Btn>
      </div>
    </Modal>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TENANT SECTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
const TDashboard = ({tenant,shops,orders,onTopup,mobile})=>{
  const pending=orders.filter(o=>o.status==="pending"||o.status==="confirming").length;
  return(<div>
    <SHead sup={`Привет, ${tenant.name}`} title="Мой кабинет" mobile={mobile}/>
    <BalBar tenant={tenant} onTopup={onTopup} mobile={mobile}/>
    <div className="mob-grid2" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
      <Stat label="Магазинов" value={shops.length} sub={`токенов: ${shops.reduce((a,b)=>a+b.tokens.length,0)}`} accent={R.accent} icon="shops" mobile={mobile}/>
      <Stat label="Заказов" value={tenant.totalOrders} sub={`${pending} ожидают`} accent={R.orange} icon="orders" mobile={mobile}/>
      <Stat label="Оборот" value={`${(tenant.totalTurnover/1000).toFixed(0)}K₽`} accent={R.cyan} icon="revenue" mobile={mobile}/>
      <Stat label="Комиссия" value={`${tenant.totalCommission.toLocaleString()}₽`} sub={`${(PLANS[tenant.plan]||PLANS.trial_week).rate}%`} accent={R.purple} icon="percent" mobile={mobile}/>
    </div>
    <div className="mob-grid1" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      <Card><div style={{padding:"16px 18px"}}>
        <div style={{fontSize:11,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Мои магазины</div>
        {shops.map(sh=>(
          <div key={sh.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:R.green,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,color:R.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sh.name}</div>
              <div style={{fontSize:10,color:R.muted}}>{sh.tokens.find(t=>t.active)?.username} · {sh.orders} заказов</div>
            </div>
            <div style={{fontSize:14,color:R.cyan,fontFamily:"'Syne'",fontWeight:700,flexShrink:0}}>{(sh.revenue/1000).toFixed(0)}K</div>
          </div>
        ))}
      </div></Card>
      <Card><div style={{padding:"16px 18px"}}>
        <div style={{fontSize:11,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Схема работы</div>
        {["Покупатель → переводит на вашу карту","Кассир подтверждает → бот выдаёт товар",`Списывается комиссия с комиссионного баланса BotFactory`,`При ${tenant.alertThreshold}₽ → уведомление в Telegram`,"При 0₽ → боты приостанавливаются"].map((s,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:8}}>
            <div style={{width:18,height:18,borderRadius:"50%",background:R.border2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:R.accent,flexShrink:0}}>{i+1}</div>
            <div style={{fontSize:12,color:R.muted,lineHeight:1.5}}>{s}</div>
          </div>
        ))}
      </div></Card>
    </div>
  </div>);
};

// ── SHOPS / BOTS ──────────────────────────────────────────────────────────────
const TShops = ({shops,setShops,tenant,onTopup,toast,mobile})=>{
  const [addModal,setAddModal]=useState(false);
  const [tokenModal,setTokenModal]=useState(null); // shopId
  const [form,setForm]=useState({name:"",ctrlToken:"",firstToken:"",firstUsername:""});
  const [tokForm,setTokForm]=useState({token:"",username:"",note:""});
  const maxShops=(PLANS[tenant.plan]||PLANS.trial_week).maxBots;
  const isBlocked=tenant.balance<=0;

  const createShop=()=>{
    if(!form.name||!form.ctrlToken||!form.firstToken)return;
    setShops([...shops,{
      id:Date.now(),name:form.name,revenue:0,orders:0,products:0,
      controlBot:{token:form.ctrlToken,username:`@${form.name.toLowerCase().replace(/\s+/g,"_")}_ctrl`,status:"active"},
      tokens:[{id:1,token:form.firstToken,username:form.firstUsername||`@${form.name.toLowerCase().replace(/\s+/g,"_")}_bot`,active:true,status:"active",note:"Основной",addedAt:new Date().toISOString().split("T")[0]}],
      admins:[{id:1,name:tenant.name,username:"@"+tenant.email.split("@")[0],role:"admin"}],
      moderators:[],
    }]);
    setAddModal(false);setForm({name:"",ctrlToken:"",firstToken:"",firstUsername:""});
    toast("Магазин создан!");
  };

  const addToken=(shopId)=>{
    if(!tokForm.token)return;
    setShops(shops.map(sh=>sh.id===shopId?{...sh,tokens:[...sh.tokens,{id:Date.now(),token:tokForm.token,username:tokForm.username||"@new_bot",active:false,status:"standby",note:tokForm.note||"Резервный",addedAt:new Date().toISOString().split("T")[0]}]}:sh));
    setTokenModal(null);setTokForm({token:"",username:"",note:""});
    toast("Токен добавлен в пул");
  };

  const setActiveToken=(shopId,tokenId)=>{
    setShops(shops.map(sh=>sh.id===shopId?{...sh,tokens:sh.tokens.map(t=>({...t,active:t.id===tokenId}))}:sh));
    toast("Активный токен переключён");
  };

  const removeToken=(shopId,tokenId)=>{
    setShops(shops.map(sh=>sh.id===shopId?{...sh,tokens:sh.tokens.filter(t=>t.id!==tokenId)}:sh));
    toast("Токен удалён");
  };

  return(<div>
    <SHead sup="Мои магазины" title="Магазины и боты"
      action={<Btn onClick={()=>shops.length<maxShops?setAddModal(true):toast("Лимит тарифа",false)}><Ic n="plus" s={14}/> Создать магазин</Btn>}
      mobile={mobile}
    />
    <BalBar tenant={tenant} onTopup={onTopup} mobile={mobile}/>

    {isBlocked&&(
      <div style={{background:`${R.red}12`,border:`1px solid ${R.red}35`,borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
        <Ic n="lock" s={18} c={R.red}/>
        <div>
          <div style={{fontSize:13,color:R.red,fontWeight:600}}>Все магазин-боты приостановлены</div>
          <div style={{fontSize:11,color:R.muted}}>Боты управления работают. Пополните баланс.</div>
        </div>
        <Btn v="danger" sm onClick={onTopup} style={{marginLeft:"auto"}}><Ic n="topup" s={13}/> Пополнить</Btn>
      </div>
    )}

    {/* Info block */}
    <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr",gap:12,marginBottom:20}}>
      <div style={{background:`${R.purple}10`,border:`1px solid ${R.purple}25`,borderRadius:10,padding:"12px 16px"}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
          <Ic n="shield" s={16} c={R.purple}/>
          <div style={{fontSize:13,color:R.purple,fontWeight:600}}>Бот управления — постоянный</div>
        </div>
        <div style={{fontSize:12,color:R.muted,lineHeight:1.7}}>Отдельный бот для вас и кассиров. Никогда не меняется и не блокируется вместе с ботом магазина.</div>
      </div>
      <div style={{background:`${R.cyan}10`,border:`1px solid ${R.cyan}25`,borderRadius:10,padding:"12px 16px"}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
          <Ic n="swap" s={16} c={R.cyan}/>
          <div style={{fontSize:13,color:R.cyan,fontWeight:600}}>Бот магазина — заменяемый</div>
        </div>
        <div style={{fontSize:12,color:R.muted,lineHeight:1.7}}>Добавьте несколько токенов. Если Telegram заблокирует бот магазина — переключитесь на резервный одним кликом.</div>
      </div>
    </div>

    {shops.map(sh=>{
      const activeToken=sh.tokens.find(t=>t.active)||sh.tokens[0];
      return(
        <Card key={sh.id} accent={isBlocked?R.red:R.green} style={{marginBottom:20}}>
          <div style={{padding:mobile?"14px":"20px 24px"}}>
            {/* Shop header */}
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:20,color:R.text}}>{sh.name}</div>
                <div style={{fontSize:11,color:R.muted,marginTop:2}}>{sh.orders} заказов · {sh.products} товаров · {(sh.revenue/1000).toFixed(0)}K ₽</div>
              </div>
              {isBlocked&&<Tag label="⛔ Приостановлен" color={R.red}/>}
              {!isBlocked&&<Tag label="● Активен" color={R.green}/>}
            </div>

            {/* CONTROL BOT — fixed, never changes */}
            <div style={{background:`${R.purple}12`,border:`1px solid ${R.purple}30`,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <Ic n="shield" s={15} c={R.purple}/>
                  <div>
                    <div style={{fontSize:12,color:R.purple,fontWeight:600}}>БОТ УПРАВЛЕНИЯ (оператор)</div>
                    <div style={{fontSize:12,color:R.muted,fontFamily:"monospace"}}>{sh.controlBot.username}</div>
                  </div>
                </div>
                <Tag label="🔒 Постоянный — не меняется" color={R.purple}/>
              </div>
              <div style={{marginTop:8,fontSize:10,color:`${R.purple}aa`,fontFamily:"'JetBrains Mono'",wordBreak:"break-all"}}>
                TOKEN: {sh.controlBot.token}
              </div>
              <div style={{marginTop:6,fontSize:11,color:R.muted}}>
                Функции: <span style={{color:R.text}}>Все (для admin)</span> · <span style={{color:R.text}}>Подтверждение платежей (для кассира)</span>
              </div>
            </div>

            {/* TOKENS POOL — main feature */}
            <div style={{border:`1px solid ${R.cyan}40`,borderRadius:10,padding:"14px 16px",marginBottom:14,background:`${R.cyan}06`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <Ic n="swap" s={16} c={R.cyan}/>
                  <div>
                    <div style={{fontSize:13,color:R.cyan,fontWeight:600}}>БОТ МАГАЗИНА — токены</div>
                    <div style={{fontSize:11,color:R.muted}}>Активен: {sh.tokens.find(t=>t.active)?.username} · Всего токенов: {sh.tokens.length}</div>
                  </div>
                </div>
                <Btn sm v="cyan" onClick={()=>setTokenModal(sh.id)}><Ic n="plus" s={12}/> Добавить токен</Btn>
              </div>

              {sh.tokens.map(tok=>{
                const isActive = tok.active;
                return (
                  <div key={tok.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",marginBottom:8,background:isActive?`${R.green}12`:R.surface,border:`2px solid ${isActive?R.green+"60":R.border}`,borderRadius:10,flexWrap:mobile?"wrap":"nowrap"}}>
                    <div style={{flexShrink:0}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:isActive?R.green:R.muted,boxShadow:isActive?`0 0 8px ${R.green}80`:undefined}}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:2}}>
                        <span style={{fontSize:13,color:isActive?R.green:R.text,fontWeight:700}}>{tok.username}</span>
                        {isActive
                          ? <Tag label="✓ АКТИВНЫЙ — принимает заказы" color={R.green}/>
                          : <Tag label={tok.note} color={R.muted}/>
                        }
                      </div>
                      <div style={{fontSize:10,color:R.muted,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tok.token} · добавлен {tok.addedAt}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      {!isActive&&(
                        <Btn sm v="success" onClick={()=>setActiveToken(sh.id,tok.id)}>
                          <Ic n="swap" s={12}/> Переключить на этот
                        </Btn>
                      )}
                      {sh.tokens.length>1&&!isActive&&(
                        <Btn sm v="danger" onClick={()=>removeToken(sh.id,tok.id)}><Ic n="trash" s={12}/></Btn>
                      )}
                    </div>
                  </div>
                );
              })}

              <div style={{marginTop:8,background:`${R.yellow}10`,border:`1px solid ${R.yellow}25`,borderRadius:8,padding:"8px 12px",display:"flex",gap:8,alignItems:"flex-start"}}>
                <Ic n="alert" s={14} c={R.yellow}/>
                <div style={{fontSize:11,color:R.yellow,lineHeight:1.6}}>
                  Если бот магазина заблокирован Telegram — создайте нового бота в @BotFather, добавьте его токен и нажмите <strong>«Переключить на этот»</strong>. Бот управления при этом не пострадает.
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="mob-grid2" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[["Заказов",sh.orders,R.accent],["Товаров",sh.products,R.cyan],["Оборот",`${(sh.revenue/1000).toFixed(0)}K₽`,R.green]].map(([k,v,c])=>(
                <div key={k} style={{background:R.card,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:20,color:c}}>{v}</div>
                  <div style={{fontSize:10,color:R.muted}}>{k}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      );
    })}

    {/* CREATE SHOP MODAL */}
    {addModal&&(
      <Modal title="Создать магазин" onClose={()=>setAddModal(false)} wide>
        <div style={{background:`${R.accent}10`,border:`1px solid ${R.accent}25`,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
          <div style={{fontSize:12,color:R.accent,marginBottom:4}}>📋 Вам нужно создать два бота в @BotFather:</div>
          <div style={{fontSize:12,color:R.muted,lineHeight:1.8}}>1. <strong style={{color:R.purple}}>Бот управления</strong> — для вас и кассиров (скрытый, не для клиентов)<br/>2. <strong style={{color:R.cyan}}>Бот магазина</strong> — для покупателей</div>
        </div>
        <Inp label="Название магазина" placeholder="Мой цифровой магазин" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
        <div style={{background:`${R.purple}12`,border:`1px solid ${R.purple}30`,borderRadius:8,padding:"12px 14px",marginBottom:4}}>
          <div style={{fontSize:11,color:R.purple,fontWeight:600,marginBottom:8}}>🛡️ БОТ УПРАВЛЕНИЯ (для вас и кассиров)</div>
          <Inp label="Токен бота управления" placeholder="7100000001:CTRL_TOKEN_HERE" value={form.ctrlToken} onChange={e=>setForm({...form,ctrlToken:e.target.value})}/>
        </div>
        <div style={{background:`${R.cyan}12`,border:`1px solid ${R.cyan}30`,borderRadius:8,padding:"12px 14px",marginBottom:14}}>
          <div style={{fontSize:11,color:R.cyan,fontWeight:600,marginBottom:8}}>🛒 БОТ МАГАЗИНА (для покупателей)</div>
          <Inp label="Токен первого бота" placeholder="7200000002:SHOP_TOKEN_HERE" value={form.firstToken} onChange={e=>setForm({...form,firstToken:e.target.value})}/>
          <Inp label="Username (необязательно)" placeholder="@myshop_bot" value={form.firstUsername} onChange={e=>setForm({...form,firstUsername:e.target.value})}/>
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn v="ghost" onClick={()=>setAddModal(false)}>Отмена</Btn>
          <Btn onClick={createShop}><Ic n="check" s={14}/> Создать магазин</Btn>
        </div>
      </Modal>
    )}

    {/* ADD TOKEN MODAL */}
    {tokenModal&&(
      <Modal title="Добавить токен в пул" onClose={()=>setTokenModal(null)}>
        <div style={{background:`${R.cyan}10`,border:`1px solid ${R.cyan}25`,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
          <div style={{fontSize:12,color:R.cyan}}>Новый токен добавляется как резервный. Переключить на него можно в любой момент — например при блокировке основного бота.</div>
        </div>
        <Inp label="Токен бота (@BotFather)" placeholder="7300000003:NEW_TOKEN_HERE" value={tokForm.token} onChange={e=>setTokForm({...tokForm,token:e.target.value})}/>
        <Inp label="Username бота" placeholder="@myshop_reserve_bot" value={tokForm.username} onChange={e=>setTokForm({...tokForm,username:e.target.value})}/>
        <Inp label="Метка (для удобства)" placeholder="Резервный #2" value={tokForm.note} onChange={e=>setTokForm({...tokForm,note:e.target.value})}/>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn v="ghost" onClick={()=>setTokenModal(null)}>Отмена</Btn>
          <Btn onClick={()=>addToken(tokenModal)}><Ic n="check" s={14}/> Добавить</Btn>
        </div>
      </Modal>
    )}
  </div>);
};

// ── ORDERS ─────────────────────────────────────────────────────────────────────
const TOrders = ({orders,setOrders,tenant,onTopup,role,mobile})=>{
  const [filter,setFilter]=useState("all");
  const [sel,setSel]=useState(null);
  const empty=tenant.balance<=0;
  const filtered=filter==="all"?orders:orders.filter(o=>o.status===filter);
  const ord=sel?orders.find(o=>o.id===sel):null;
  const confirm=async id=>{
    if(empty&&role!=="moderator"){return;}
    try{
      await adminApi(`/orders/${id}/confirm`,{method:"POST"});
      setOrders(orders.map(o=>o.id===id?{...o,status:"completed"}:o));
      setSel(null);
      window.bfReload&&window.bfReload();
    }catch(e){ alert(e.message||"Ошибка подтверждения"); }
  };
  const reject=async id=>{
    try{
      await adminApi(`/orders/${id}/reject`,{method:"POST"});
      setOrders(orders.map(o=>o.id===id?{...o,status:"rejected"}:o));setSel(null);
      window.bfReload&&window.bfReload();
    }catch(e){ alert(e.message||"Ошибка отклонения"); }
  };

  return(<div>
    <SHead sup={role==="moderator"?"Режим кассира":"Управление"} title="Заказы" mobile={mobile}
      action={role==="moderator"&&<Tag label="⚡ Только подтверждение платежей" color={R.orange}/>}
    />
    {role!=="moderator"&&<BalBar tenant={tenant} onTopup={onTopup} mobile={mobile}/>}
    {empty&&role!=="moderator"&&(
      <div style={{background:`${R.red}12`,border:`1px solid ${R.red}30`,borderRadius:10,padding:"12px 14px",marginBottom:16,fontSize:13,color:R.red}}>
        Подтверждение недоступно — баланс исчерпан. <button onClick={onTopup} style={{background:"none",border:"none",color:R.accent,cursor:"pointer",fontSize:13,textDecoration:"underline"}}>Пополнить →</button>
      </div>
    )}

    {/* Filter tabs */}
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
      {[["all","Все"],["pending","Ожидают"],["confirming","Проверка"],["completed","Выполнены"],["rejected","Отклонены"]].map(([v,l])=>(
        <button key={v} onClick={()=>setFilter(v)} style={{background:filter===v?R.accent:R.surface,color:filter===v?"#fff":R.muted,border:`1px solid ${filter===v?R.accent:R.border2}`,borderRadius:20,padding:"6px 12px",fontSize:11,fontFamily:"'JetBrains Mono'",cursor:"pointer"}}>
          {l}{v!=="all"&&` (${orders.filter(o=>o.status===v).length})`}
        </button>
      ))}
    </div>

    {/* Mobile: card list | Desktop: table */}
    {mobile?(
      <div>
        {filtered.map(o=>(
          <MobCard key={o.id} onClick={()=>setSel(o.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:13,color:R.text,fontWeight:600}}>{o.product}</div>
                <div style={{fontSize:11,color:R.cyan}}>{o.buyer} · {o.shopName}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:16,color:R.green,fontFamily:"'Syne'",fontWeight:700}}>{o.amount}₽</div>
                <div style={{fontSize:10,color:R.accent}}>−{o.commission}₽</div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <OrderBadge status={o.status}/>
              <div style={{fontSize:10,color:R.muted}}>{o.date}</div>
            </div>
          </MobCard>
        ))}
      </div>
    ):(
      <Card>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["#","Товар","Покупатель","Магазин","Сумма","Комиссия","Карта","Дата","Статус",""].map(h=><TH key={h} ch={h}/>)}</tr></thead>
            <tbody>{filtered.map(o=>(
              <tr key={o.id} onClick={()=>setSel(o.id)} style={{cursor:"pointer"}}>
                <TD muted>#{o.id}</TD>
                <TD>{o.product}</TD>
                <TD accent={R.cyan}>{o.buyer}</TD>
                <TD muted>{o.shopName}</TD>
                <TD accent={R.green}>{o.amount}₽</TD>
                <TD accent={R.accent}>−{o.commission}₽</TD>
                <TD muted>*{o.cardId}</TD>
                <TD muted>{o.date}</TD>
                <TD><OrderBadge status={o.status}/></TD>
                <TD><Btn sm v="ghost"><Ic n="eye" s={13}/></Btn></TD>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    )}

    {/* Order detail modal */}
    {ord&&(
      <Modal title={`Заказ #${ord.id}`} onClose={()=>setSel(null)}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {[["Покупатель",ord.buyer,R.cyan],["Telegram ID",ord.buyerId,null],["Товар",ord.product,null],["Магазин",ord.shopName,null],["К получению",`${ord.amount}₽`,R.green],["Комиссия BF",`−${ord.commission}₽`,R.accent]].map(([k,v,c])=>(
            <div key={k} style={{background:R.surface,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{k}</div>
              <div style={{fontSize:13,color:c||R.text,marginTop:4,fontWeight:600}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{background:R.surface,borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Скриншот оплаты</div>
          {ord.proof?<div style={{background:R.card,borderRadius:8,padding:24,textAlign:"center",color:R.muted,fontSize:12}}>📎 {ord.proof}</div>:<div style={{color:R.muted,fontSize:12}}>Скриншот не прикреплён</div>}
        </div>
        <div style={{marginBottom:14}}><OrderBadge status={ord.status}/></div>
        {(ord.status==="confirming"||ord.status==="pending")&&(
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
            <Btn v="danger" onClick={()=>reject(ord.id)}><Ic n="close" s={14}/> Отклонить</Btn>
            <Btn v="success" disabled={empty&&role!=="moderator"} onClick={()=>confirm(ord.id)}><Ic n="check" s={14}/> Подтвердить — выдать товар</Btn>
          </div>
        )}
      </Modal>
    )}
  </div>);
};

// ── CARDS ──────────────────────────────────────────────────────────────────────
const TCards = ({cards,setCards,shops,toast,mobile})=>{
  const [modal,setModal]=useState(false);
  const [shopF,setShopF]=useState("all");
  const [form,setForm]=useState({shopId:shops[0]?.id||"",bank:"",number:"",holder:"",phone:""});
  const filtered=shopF==="all"?cards:cards.filter(c=>c.shopId===Number(shopF));
  const banks=["Сбербанк","Тинькофф","ВТБ","Альфа-банк","Газпромбанк","МТС Банк","Открытие","Райффайзен"];

  return(<div>
    <SHead sup="Платёжные реквизиты" title="Пул карт"
      action={<Btn onClick={()=>setModal(true)}><Ic n="plus" s={14}/> Добавить карту</Btn>}
      mobile={mobile}
    />
    <div style={{background:`${R.green}10`,border:`1px solid ${R.green}25`,borderRadius:10,padding:"11px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
      <Ic n="shuffle" s={16} c={R.green}/>
      <span style={{fontSize:12,color:R.green}}>Активная карта выдаётся покупателям <strong>случайно</strong> для равномерного распределения</span>
    </div>

    {/* Shop filter */}
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
      {[["all","Все магазины"],...shops.map(s=>[String(s.id),s.name])].map(([v,l])=>(
        <button key={v} onClick={()=>setShopF(v)} style={{background:shopF===v?R.accent:R.surface,color:shopF===v?"#fff":R.muted,border:`1px solid ${shopF===v?R.accent:R.border2}`,borderRadius:20,padding:"6px 12px",fontSize:11,fontFamily:"'JetBrains Mono'",cursor:"pointer"}}>{l}</button>
      ))}
    </div>

    <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"repeat(auto-fill,minmax(270px,1fr))",gap:14}}>
      {filtered.map(c=>(
        <Card key={c.id} accent={c.active?R.cyan:R.border}>
          <div style={{padding:mobile?"14px":"18px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <span style={{fontSize:13,color:c.active?R.cyan:R.muted,fontWeight:700}}>{c.bank}</span>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {c.active&&<span style={{fontSize:9,color:R.green,background:`${R.green}15`,border:`1px solid ${R.green}30`,padding:"2px 7px",borderRadius:10}}>В пуле</span>}
                <Tag label={c.active?"✓":"×"} color={c.active?R.green:R.muted}/>
              </div>
            </div>
            <div style={{fontSize:16,color:R.text,letterSpacing:"0.1em",marginBottom:4,fontFamily:"monospace"}}>{c.number}</div>
            <div style={{fontSize:11,color:R.muted,marginBottom:2}}>{c.holder}</div>
            {c.phone&&<div style={{fontSize:11,color:R.muted,marginBottom:10}}>СБП: {c.phone}</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              {[["Заказов",c.orders,R.accent],["Получено",`${(c.received/1000).toFixed(0)}K₽`,R.green]].map(([k,v,col])=>(
                <div key={k} style={{background:R.surface,borderRadius:7,padding:"8px 10px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:16,color:col}}>{v}</div>
                  <div style={{fontSize:9,color:R.muted}}>{k}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn sm v={c.active?"warning":"success"} onClick={()=>{setCards(cards.map(x=>x.id===c.id?{...x,active:!x.active}:x));toast(c.active?"Убрана из пула":"В пул");}}>
                {c.active?"Убрать":"В пул"}
              </Btn>
              <Btn sm v="danger" onClick={()=>{setCards(cards.filter(x=>x.id!==c.id));toast("Удалена");}}><Ic n="trash" s={13}/></Btn>
            </div>
          </div>
        </Card>
      ))}
    </div>

    {modal&&(
      <Modal title="Добавить карту в пул" onClose={()=>setModal(false)}>
        <Sel label="Магазин" value={form.shopId} onChange={e=>setForm({...form,shopId:e.target.value})}>
          {shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </Sel>
        <Sel label="Банк" value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})}>
          <option value="">Выберите банк...</option>
          {banks.map(b=><option key={b} value={b}>{b}</option>)}
        </Sel>
        <Inp label="Номер карты" placeholder="4276 1234 5678 9012" value={form.number} onChange={e=>setForm({...form,number:e.target.value})}/>
        <Inp label="Имя (латиница)" placeholder="IVAN PETROV" value={form.holder} onChange={e=>setForm({...form,holder:e.target.value})}/>
        <Inp label="Номер для СБП (необяз.)" placeholder="+7 999 123-45-67" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
          <Btn v="ghost" onClick={()=>setModal(false)}>Отмена</Btn>
          <Btn onClick={()=>{if(!form.number||!form.holder)return;setCards([...cards,{id:Date.now(),shopId:Number(form.shopId),bank:form.bank,number:form.number,holder:form.holder.toUpperCase(),phone:form.phone,active:true,orders:0,received:0}]);setModal(false);toast("Карта добавлена");}}><Ic n="check" s={14}/> Добавить</Btn>
        </div>
      </Modal>
    )}
  </div>);
};

// ── TEAM (moderators per shop) ─────────────────────────────────────────────────
const TTeam = ({shops,setShops,toast,mobile})=>{
  const [modal,setModal]=useState(null); // shopId
  const [form,setForm]=useState({name:"",username:"",role:"moderator"});

  const addMember=(shopId)=>{
    if(!form.name||!form.username)return;
    setShops(shops.map(sh=>sh.id===shopId?{...sh,moderators:[...sh.moderators,{id:Date.now(),name:form.name,username:form.username,role:form.role,addedAt:new Date().toISOString().split("T")[0]}]}:sh));
    setModal(null);setForm({name:"",username:"",role:"moderator"});
    toast("Участник добавлен в бот управления");
  };

  const removeMember=(shopId,memberId)=>{
    setShops(shops.map(sh=>sh.id===shopId?{...sh,moderators:sh.moderators.filter(m=>m.id!==memberId)}:sh));
    toast("Участник удалён");
  };

  return(<div>
    <SHead sup="Команда" title="Кассиры и модераторы" mobile={mobile}/>

    <div style={{background:`${R.accent}10`,border:`1px solid ${R.accent}25`,borderRadius:10,padding:"12px 16px",marginBottom:20}}>
      <div style={{fontFamily:"'Syne'",fontWeight:700,fontSize:15,color:R.text,marginBottom:6}}>Бот управления для команды</div>
      <div style={{fontSize:12,color:R.muted,lineHeight:1.8}}>
        Каждый магазин имеет свой бот управления. Кассир получает доступ через него.<br/>
        <strong style={{color:R.text}}>Кассир:</strong> подтверждение/отклонение платежей<br/>
        <strong style={{color:R.text}}>Администратор:</strong> всё — товары, карты, статистика, баланс, назначение кассиров
      </div>
    </div>

    {shops.map(sh=>(
      <Card key={sh.id} style={{marginBottom:20}}>
        <div style={{padding:mobile?"14px":"18px 22px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontFamily:"'Syne'",fontWeight:700,fontSize:17,color:R.text}}>{sh.name}</div>
              <div style={{fontSize:11,color:R.purple}}>Бот управления: {sh.controlBot.username}</div>
            </div>
            <Btn sm onClick={()=>setModal(sh.id)}><Ic n="plus" s={13}/> Добавить кассира</Btn>
          </div>

          {/* Admins */}
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Администраторы</div>
            {sh.admins.map(a=>(
              <div key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:`${R.accent}10`,border:`1px solid ${R.accent}25`,borderRadius:8,marginBottom:6}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:`${R.accent}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:R.accent,fontWeight:700,flexShrink:0}}>А</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,color:R.text,fontWeight:600}}>{a.name}</div>
                  <div style={{fontSize:11,color:R.muted}}>{a.username}</div>
                </div>
                <Tag label="Администратор" color={R.accent}/>
              </div>
            ))}
          </div>

          {/* Moderators */}
          <div>
            <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Кассиры / Модераторы</div>
            {sh.moderators.length===0&&<div style={{fontSize:12,color:R.muted,padding:"10px 0"}}>Кассиры не добавлены</div>}
            {sh.moderators.map(m=>(
              <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:R.surface,border:`1px solid ${R.border}`,borderRadius:8,marginBottom:6,flexWrap:mobile?"wrap":"nowrap"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:`${R.yellow}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:R.yellow,fontWeight:700,flexShrink:0}}>К</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:R.text,fontWeight:600}}>{m.name}</div>
                  <div style={{fontSize:11,color:R.cyan}}>{m.username} · добавлен {m.addedAt}</div>
                </div>
                <Tag label="Кассир" color={R.yellow}/>
                <Btn sm v="danger" onClick={()=>removeMember(sh.id,m.id)}><Ic n="trash" s={13}/></Btn>
              </div>
            ))}
          </div>
        </div>
      </Card>
    ))}

    {modal&&(
      <Modal title={`Добавить участника — ${shops.find(s=>s.id===modal)?.name}`} onClose={()=>setModal(null)}>
        <div style={{background:`${R.yellow}10`,border:`1px solid ${R.yellow}25`,borderRadius:8,padding:"10px 14px",marginBottom:16}}>
          <div style={{fontSize:12,color:R.yellow}}>Участник получит доступ через бот управления магазина</div>
        </div>
        <Inp label="Имя" placeholder="Иван Иванов" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
        <Inp label="Telegram Username" placeholder="@cashier_name" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/>
        <Sel label="Роль" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
          <option value="moderator">Кассир — только подтверждение платежей</option>
        </Sel>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn v="ghost" onClick={()=>setModal(null)}>Отмена</Btn>
          <Btn onClick={()=>addMember(modal)}><Ic n="check" s={14}/> Добавить</Btn>
        </div>
      </Modal>
    )}
  </div>);
};

// ── BALANCE ────────────────────────────────────────────────────────────────────
const TBalance = ({tenant,setTenant,txs,onTopup,mobile})=>{
  const [thresh,setThresh]=useState(String(tenant.alertThreshold));
  const plan=PLANS[tenant.plan]||PLANS.trial_week;
  const empty=tenant.balance<=0, low=tenant.balance>0&&tenant.balance<=tenant.alertThreshold;
  const c=empty?R.red:low?R.yellow:R.green;

  return(<div>
    <SHead sup="Финансы" title="Комиссионный баланс"
      action={<Btn onClick={onTopup}><Ic n="topup" s={14}/> Пополнить</Btn>}
      mobile={mobile}
    />

    {/* Big balance card */}
    <Card accent={c} glow={c} style={{marginBottom:20}}>
      <div style={{padding:mobile?"16px":"22px 28px"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,color:R.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Комиссионный баланс BotFactory</div>
            <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:mobile?36:48,color:c,lineHeight:1,marginBottom:6}}>{tenant.balance.toLocaleString()} ₽</div>
            <div style={{fontSize:12,color:R.muted}}>Тариф: {plan.label} · Комиссия: {plan.rate}% с заказа</div>
          </div>
          <Btn onClick={onTopup} style={{marginTop:8}}><Ic n="topup" s={15}/> Пополнить баланс</Btn>
        </div>
        {(empty||low)&&(
          <div style={{marginTop:16,background:empty?`${R.red}15`:`${R.yellow}12`,border:`1px solid ${c}30`,borderRadius:10,padding:"12px 16px",display:"flex",gap:10,alignItems:"center"}}>
            <Ic n={empty?"lock":"alert"} s={18} c={c}/>
            <div>
              <div style={{fontSize:13,color:c,fontWeight:600}}>{empty?"⛔ Боты остановлены — пополните баланс":"⚠️ Баланс ниже порога уведомления"}</div>
              <div style={{fontSize:11,color:R.muted,marginTop:2}}>{empty?"Как только пополните — боты запустятся автоматически.":`Уведомление в Telegram уже отправлено. Порог: ${tenant.alertThreshold.toLocaleString()} ₽`}</div>
            </div>
          </div>
        )}
      </div>
    </Card>

    <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr",gap:16,marginBottom:20}}>
      {/* Alert threshold */}
      <Card accent={R.yellow} glow={R.yellow}>
        <div style={{padding:mobile?"14px":"18px 22px"}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14}}>
            <Ic n="bell" s={18} c={R.yellow}/>
            <div style={{fontSize:14,color:R.text,fontWeight:600}}>Порог уведомления</div>
          </div>
          <div style={{fontSize:12,color:R.muted,marginBottom:14,lineHeight:1.7}}>
            При достижении этой суммы — вам придёт сообщение в бот управления. Боты продолжат работать до нуля.
          </div>
          <F label="Порог (₽)">
            <input type="number" value={thresh} onChange={e=>setThresh(e.target.value)} style={{...baseInput}}/>
          </F>
          <Btn full onClick={()=>setTenant({...tenant,alertThreshold:Number(thresh)})}><Ic n="check" s={14}/> Сохранить порог</Btn>
        </div>
      </Card>

      {/* Summary */}
      <Card><div style={{padding:mobile?"14px":"18px 22px"}}>
        <div style={{fontSize:12,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Итоги</div>
        {[["Текущий баланс",`${tenant.balance.toLocaleString()} ₽`,c],["Порог уведомления",`${tenant.alertThreshold.toLocaleString()} ₽`,R.yellow],["Комиссия платформы",`${plan.rate}%`,R.muted],["Списано за всё время",`${tenant.totalCommission.toLocaleString()} ₽`,R.red],["Оборот за всё время",`${tenant.totalTurnover.toLocaleString()} ₽`,R.cyan],["Мой заработок",`${(tenant.totalTurnover-tenant.totalCommission).toLocaleString()} ₽`,R.green]].map(([k,v,col])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${R.border}`}}>
            <span style={{fontSize:12,color:R.muted}}>{k}</span>
            <span style={{fontSize:13,color:col,fontWeight:600}}>{v}</span>
          </div>
        ))}
      </div></Card>
    </div>

    {/* Transactions */}
    <Card><div style={{padding:mobile?"14px":"18px 22px 0"}}>
      <div style={{fontSize:12,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>История транзакций</div>
    </div>
    {mobile?(
      <div style={{padding:"0 14px 14px"}}>
        {[...txs].reverse().map(tx=>{
          const cfg={deposit:{l:"Пополнение",c:R.green},commission:{l:"Комиссия",c:R.accent},alert:{l:"Уведомление",c:R.yellow}}[tx.type]||{l:tx.type,c:R.muted};
          return(
            <div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${R.border}`}}>
              <div>
                <div style={{marginBottom:2}}><Tag label={cfg.l} color={cfg.c}/></div>
                <div style={{fontSize:11,color:R.muted}}>{tx.date}</div>
                <div style={{fontSize:11,color:R.muted,marginTop:2}}>{tx.note}</div>
              </div>
              <div style={{fontSize:15,color:tx.amount>0?R.green:tx.amount<0?R.red:R.muted,fontWeight:700,fontFamily:"'Syne'"}}>{tx.amount>0?"+":""}{tx.amount!==0?`${tx.amount.toLocaleString()}₽`:"—"}</div>
            </div>
          );
        })}
      </div>
    ):(
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Дата","Тип","Сумма","Примечание"].map(h=><TH key={h} ch={h}/>)}</tr></thead>
          <tbody>{[...txs].reverse().map(tx=>{
            const cfg={deposit:{l:"Пополнение",c:R.green},commission:{l:"Комиссия",c:R.accent},alert:{l:"Уведомление",c:R.yellow}}[tx.type]||{l:tx.type,c:R.muted};
            return(<tr key={tx.id}>
              <TD muted>{tx.date}</TD>
              <TD><Tag label={cfg.l} color={cfg.c}/></TD>
              <TD accent={tx.amount>0?R.green:tx.amount<0?R.red:R.muted}>{tx.amount>0?"+":""}{tx.amount!==0?`${tx.amount.toLocaleString()} ₽`:"—"}</TD>
              <TD muted>{tx.note}</TD>
            </tr>);
          })}</tbody>
        </table>
      </div>
    )}
    </Card>
  </div>);
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM VIEWS
// ═══════════════════════════════════════════════════════════════════════════════
const PlatformView = ({tenants,setTenants,toast,mobile})=>(
  <div>
    <SHead sup="Платформа BotFactory" title="Пользователи и балансы" mobile={mobile}/>
    <div className="mob-grid2" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
      <Stat label="Пользователей" value={tenants.length} accent={R.accent} icon="users" mobile={mobile}/>
      <Stat label="Суммарный оборот" value={`${(tenants.reduce((a,b)=>a+b.totalTurnover,0)/1000).toFixed(0)}K₽`} accent={R.cyan} icon="revenue" mobile={mobile}/>
      <Stat label="Наша комиссия" value={`${tenants.reduce((a,b)=>a+b.totalCommission,0).toLocaleString()}₽`} accent={R.green} icon="percent" mobile={mobile}/>
      <Stat label="Проблемных" value={tenants.filter(t=>t.balance<=t.alertThreshold).length} accent={R.red} icon="alert" mobile={mobile}/>
    </div>

    {/* Problems */}
    {tenants.filter(t=>t.balance<=t.alertThreshold).length>0&&(
      <div style={{marginBottom:20}}>
        <div style={{fontSize:11,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>⚡ Требуют внимания</div>
        <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr",gap:10}}>
          {tenants.filter(t=>t.balance<=t.alertThreshold).map(t=>{
            const empty=t.balance<=0;const c=empty?R.red:R.yellow;
            return(<div key={t.id} style={{background:`${c}10`,border:`1px solid ${c}30`,borderRadius:10,padding:"12px 14px",display:"flex",gap:10,alignItems:"center"}}>
              <Ic n={empty?"lock":"alert"} s={18} c={c}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:R.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                <div style={{fontSize:11,color:R.muted}}>{empty?"Баланс 0 — боты заблокированы":`Низкий баланс: ${t.balance}₽`}</div>
              </div>
              <Tag label={empty?"⛔ Блок":"⚠️ Низкий"} color={c}/>
            </div>);
          })}
        </div>
      </div>
    )}

    {/* Users table / cards */}
    {mobile?(
      <div>
        {tenants.map(t=>{
          const empty=t.balance<=0,low=t.balance>0&&t.balance<=t.alertThreshold;
          const c=empty?R.red:low?R.yellow:R.green;
          return(
            <MobCard key={t.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:14,color:R.text,fontWeight:600}}>{t.name}</div>
                  <div style={{fontSize:11,color:R.muted}}>{t.email}</div>
                </div>
                <PlanTag plan={t.plan}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:18,color:c}}>{t.balance.toLocaleString()}₽</div>
                <div style={{fontSize:12,color:R.green}}>+{t.totalCommission.toLocaleString()}₽</div>
              </div>
            </MobCard>
          );
        })}
      </div>
    ):(
      <Card>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Пользователь","Тариф","Баланс","Порог","Статус","Оборот","Комиссия нам",""].map(h=><TH key={h} ch={h}/>)}</tr></thead>
            <tbody>{tenants.map(t=>{
              const empty=t.balance<=0,low=t.balance>0&&t.balance<=t.alertThreshold;
              const c=empty?R.red:low?R.yellow:R.green;
              return(<tr key={t.id}>
                <TD><div style={{fontWeight:600}}>{t.name}<br/><span style={{fontSize:10,color:R.muted}}>{t.email}</span></div></TD>
                <TD><PlanTag plan={t.plan}/></TD>
                <TD><span style={{color:c,fontWeight:700,fontFamily:"'Syne'",fontSize:16}}>{t.balance.toLocaleString()}₽</span></TD>
                <TD muted>{t.alertThreshold.toLocaleString()}₽</TD>
                <TD>{empty?<Tag label="⛔ Блок" color={R.red}/>:low?<Tag label="⚠️ Низкий" color={R.yellow}/>:<Tag label="✓ Норма" color={R.green}/>}</TD>
                <TD accent={R.cyan}>{t.totalTurnover.toLocaleString()}₽</TD>
                <TD accent={R.green}>+{t.totalCommission.toLocaleString()}₽</TD>
                <TD>
                  <Btn sm v={t.status==="active"?"warning":"success"} onClick={()=>{setTenants(tenants.map(x=>x.id===t.id?{...x,status:x.status==="active"?"blocked":"active"}:x));toast(t.status==="active"?"Заблокирован":"Разблокирован");}}>
                    {t.status==="active"?"Блок":"Разблок"}
                  </Btn>
                </TD>
              </tr>);
            })}</tbody>
          </table>
        </div>
      </Card>
    )}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
const NAV = {
  platform: [
    {id:"dashboard",n:"dashboard",l:"Платформа"},
    {id:"settings",n:"settings",l:"Настройки"},
  ],
  tenant: [
    {id:"dashboard",n:"dashboard",l:"Кабинет"},
    {id:"shops",n:"shops",l:"Магазины"},
    {id:"orders",n:"orders",l:"Заказы"},
    {id:"cards",n:"cards",l:"Карты"},
    {id:"team",n:"team",l:"Команда"},
    {id:"balance",n:"wallet",l:"Баланс"},
  ],
  moderator:[
    {id:"orders",n:"orders",l:"Заказы"},
  ],
};

export default function App() {
  const mobile = useMobile();
  const [mode,setMode] = useState("platform");
  const [view,setView] = useState("dashboard");
  const [sideOpen,setSideOpen] = useState(false);
  const [toast,setToast] = useState(null);
  const [topupOpen,setTopupOpen] = useState(false);

  const [tenant,setTenant] = useState(EMPTY_TENANT);
  const [shops,setShops] = useState([]);
  const [cards,setCards] = useState([]);
  const [orders,setOrders] = useState([]);
  const [txs,setTxs] = useState([]);
  const [platformTenants,setPlatformTenants] = useState([]);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState("");

  const showToast = (msg,ok=true) => setToast({msg,ok});

  const loadOverview = useCallback(async () => {
    try {
      const data = await adminApi("/overview");
      setLoadError("");
      const mapped = mapOverview(data, tenant?.id);
      setTenant(mapped.tenant);
      setShops(mapped.shops);
      setCards(mapped.cards);
      setOrders(mapped.orders);
      setTxs(mapped.txs);
      setPlatformTenants(mapped.platformTenants);
    } catch (e) {
      setLoadError(e.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => { loadOverview(); }, []);
  useEffect(() => { window.bfReload = loadOverview; return () => { delete window.bfReload; }; }, [loadOverview]);

  const switchMode = m => {
    setMode(m);
    setView(m==="moderator"?"orders":"dashboard");
    setSideOpen(false);
  };

  const handleTopup = async amt => {
    if(amt<100 || !tenant.id) return;
    try {
      await adminApi(`/tenants/${tenant.id}/topup`, { method:"POST", body:JSON.stringify({ amount:amt, note:"Пополнение комиссионного баланса через панель" }) });
      await loadOverview();
      showToast(`Комиссионный баланс пополнен на ${amt.toLocaleString()} ₽`);
    } catch(e) {
      showToast(e.message || "Ошибка пополнения", false);
    }
  };

  const modeColor = {platform:R.accent, tenant:R.cyan, moderator:R.orange}[mode];
  const modeLabel = {platform:"Платформа", tenant:tenant.name, moderator:"Кассир"}[mode];
  const navItems = NAV[mode]||[];

  const pendingCount = orders.filter(o=>o.status==="pending"||o.status==="confirming").length;
  const navWithBadge = navItems.map(n=>n.id==="orders"?{...n,badge:pendingCount}:n);

  const isLow = tenant.balance>0&&tenant.balance<=tenant.alertThreshold;
  const isEmpty = tenant.balance<=0;
  const balColor = isEmpty?R.red:isLow?R.yellow:R.green;

  // ── SIDEBAR content ──────────────────────────────────────────────────────────
  const SidebarContent = () => (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflowY:"auto"}}>
      {/* Logo */}
      <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${R.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:`linear-gradient(135deg,${R.accent},${R.purple})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{color:"#fff",fontFamily:"'Syne'",fontWeight:800,fontSize:14}}>BF</span>
          </div>
          <div>
            <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:15,color:R.text,lineHeight:1}}>BotFactory</div>
            <div style={{fontSize:10,color:R.muted}}>SaaS Platform</div>
          </div>
        </div>
      </div>

      {/* Mode switcher */}
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${R.border}`,flexShrink:0}}>
        <div style={{fontSize:9,color:R.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Режим</div>
        {[["platform","🏢 Платформа"],["tenant","🛒 Владелец магазина"],["moderator","💼 Кассир"]].map(([m,l])=>(
          <button key={m} onClick={()=>switchMode(m)} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"7px 10px",marginBottom:2,background:mode===m?`${modeColor}15`:"transparent",border:`1px solid ${mode===m?modeColor+"40":"transparent"}`,borderRadius:7,color:mode===m?modeColor:R.muted,cursor:"pointer",fontSize:12,fontFamily:"'JetBrains Mono'",textAlign:"left"}}>{l}</button>
        ))}
      </div>

      {/* Context */}
      <div style={{padding:"8px 12px",borderBottom:`1px solid ${R.border}`,background:`${modeColor}08`,flexShrink:0}}>
        <div style={{fontSize:11,color:modeColor,fontWeight:600}}>{modeLabel}</div>
        {mode==="tenant"&&<div style={{fontSize:10,color:R.muted}}>Тариф: {(PLANS[tenant.plan]||PLANS.trial_week).label} · {(PLANS[tenant.plan]||PLANS.trial_week).rate}%</div>}
      </div>

      {/* Balance widget (tenant) */}
      {mode==="tenant"&&(
        <div onClick={()=>{setTopupOpen(true);setSideOpen(false);}} style={{margin:"8px 10px",background:`${balColor}12`,border:`1px solid ${balColor}35`,borderRadius:9,padding:"9px 12px",cursor:"pointer",flexShrink:0}}>
          <div style={{fontSize:9,color:R.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Комиссионный баланс</div>
          <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:18,color:balColor,lineHeight:1,marginTop:2}}>{tenant.balance.toLocaleString()} ₽</div>
          {isEmpty&&<div style={{fontSize:9,color:R.red,marginTop:2}}>⛔ Боты остановлены</div>}
          {isLow&&!isEmpty&&<div style={{fontSize:9,color:R.yellow,marginTop:2}}>⚠️ Низкий баланс</div>}
        </div>
      )}

      {/* Nav */}
      <nav style={{flex:1,padding:"6px 0"}}>
        {navWithBadge.map(n=>(
          <button key={n.id} onClick={()=>{setView(n.id);setSideOpen(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 16px",background:"transparent",border:"none",borderLeft:`3px solid ${view===n.id?modeColor:"transparent"}`,color:view===n.id?modeColor:R.muted,cursor:"pointer",textAlign:"left",fontSize:13,fontFamily:"'JetBrains Mono'"}}>
            <Ic n={n.n} s={15} c={view===n.id?modeColor:R.muted}/>
            {n.l}
            {n.badge>0&&<span style={{marginLeft:"auto",background:R.red,color:"#000",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{n.badge}</span>}
          </button>
        ))}
      </nav>

      {/* Status */}
      <div style={{padding:"12px 16px",borderTop:`1px solid ${R.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:R.green}}/>
          <span style={{fontSize:10,color:R.muted}}>Система работает</span>
        </div>
      </div>
    </div>
  );

  return(<>
    <style>{css}</style>
    <div style={{display:"flex",minHeight:"100vh",background:R.bg}}>

      {/* ── DESKTOP SIDEBAR ──────────────────────────────── */}
      {!mobile&&(
        <div className="hide-mobile" style={{width:224,background:R.surface,borderRight:`1px solid ${R.border}`,position:"fixed",top:0,bottom:0,left:0,zIndex:100}}>
          <SidebarContent/>
        </div>
      )}

      {/* ── MOBILE: top bar + drawer ─────────────────────── */}
      {mobile&&(<>
        <div style={{position:"fixed",top:0,left:0,right:0,height:52,background:R.surface,borderBottom:`1px solid ${R.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",zIndex:200}}>
          <button onClick={()=>setSideOpen(true)} style={{background:"none",border:"none",color:R.muted,cursor:"pointer",padding:6}}><Ic n="menu" s={22}/></button>
          <div style={{fontFamily:"'Syne'",fontWeight:800,fontSize:16,color:R.text}}>BotFactory</div>
          {mode==="tenant"?(
            <div onClick={()=>setTopupOpen(true)} style={{background:`${balColor}18`,border:`1px solid ${balColor}40`,borderRadius:8,padding:"4px 10px",cursor:"pointer"}}>
              <div style={{fontFamily:"'Syne'",fontWeight:700,fontSize:14,color:balColor}}>{tenant.balance.toLocaleString()}₽</div>
            </div>
          ):<div style={{width:40}}/>}
        </div>

        {/* Drawer overlay */}
        {sideOpen&&(
          <div style={{position:"fixed",inset:0,zIndex:500}} onClick={()=>setSideOpen(false)}>
            <div style={{position:"absolute",inset:0,background:"#000000c0"}}/>
            <div style={{position:"absolute",top:0,left:0,bottom:0,width:256,background:R.surface,borderRight:`1px solid ${R.border}`}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"flex-end",padding:"10px 12px"}}>
                <button onClick={()=>setSideOpen(false)} style={{background:"none",border:"none",color:R.muted,cursor:"pointer"}}><Ic n="close" s={20}/></button>
              </div>
              <div style={{height:"calc(100% - 44px)"}}>
                <SidebarContent/>
              </div>
            </div>
          </div>
        )}

        {/* Mobile bottom nav */}
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:R.surface,borderTop:`1px solid ${R.border}`,display:"flex",zIndex:200,paddingBottom:"env(safe-area-inset-bottom)"}}>
          {navWithBadge.map(n=>(
            <button key={n.id} onClick={()=>setView(n.id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 4px",background:"transparent",border:"none",color:view===n.id?modeColor:R.muted,cursor:"pointer",position:"relative"}}>
              <Ic n={n.n} s={20} c={view===n.id?modeColor:R.muted}/>
              <span style={{fontSize:9,marginTop:2,fontFamily:"'JetBrains Mono'"}}>{n.l}</span>
              {n.badge>0&&<span style={{position:"absolute",top:4,right:"calc(50% - 16px)",background:R.red,color:"#fff",borderRadius:8,padding:"1px 5px",fontSize:9,fontWeight:700}}>{n.badge}</span>}
            </button>
          ))}
        </div>
      </>)}

      {/* ── MAIN CONTENT ─────────────────────────────────── */}
      <div style={{marginLeft:mobile?0:224,flex:1,padding:mobile?"68px 14px 80px":"28px 32px",minWidth:0}}>

        {loading&&(<div style={{background:R.surface,border:`1px solid ${R.border}`,borderRadius:10,padding:"12px 14px",marginBottom:16,color:R.muted,fontSize:13}}>Загрузка данных...</div>)}
        {loadError&&(<div style={{background:`${R.red}10`,border:`1px solid ${R.red}30`,borderRadius:10,padding:"12px 14px",marginBottom:16,color:R.red,fontSize:13}}>Ошибка API: {loadError}</div>)}

        {/* Moderator banner */}
        {mode==="moderator"&&(
          <div style={{background:`${R.orange}10`,border:`1px solid ${R.orange}25`,borderRadius:10,padding:"10px 14px",marginBottom:16,display:"flex",gap:8,alignItems:"center"}}>
            <Ic n="lock" s={16} c={R.orange}/>
            <span style={{fontSize:12,color:R.orange}}>Режим кассира — доступны только заказы</span>
          </div>
        )}

        {/* PLATFORM */}
        {mode==="platform"&&<PlatformView tenants={platformTenants} setTenants={setPlatformTenants} toast={showToast} mobile={mobile}/>}

        {/* TENANT */}
        {mode==="tenant"&&view==="dashboard"&&<TDashboard tenant={tenant} shops={shops} orders={orders} onTopup={()=>setTopupOpen(true)} mobile={mobile}/>}
        {mode==="tenant"&&view==="shops"&&<TShops shops={shops} setShops={setShops} tenant={tenant} onTopup={()=>setTopupOpen(true)} toast={showToast} mobile={mobile}/>}
        {mode==="tenant"&&view==="orders"&&<TOrders orders={orders} setOrders={setOrders} tenant={tenant} onTopup={()=>setTopupOpen(true)} role="admin" mobile={mobile}/>}
        {mode==="tenant"&&view==="cards"&&<TCards cards={cards} setCards={setCards} shops={shops} toast={showToast} mobile={mobile}/>}
        {mode==="tenant"&&view==="team"&&<TTeam shops={shops} setShops={setShops} toast={showToast} mobile={mobile}/>}
        {mode==="tenant"&&view==="balance"&&<TBalance tenant={tenant} setTenant={setTenant} txs={txs} onTopup={()=>setTopupOpen(true)} mobile={mobile}/>}

        {/* MODERATOR */}
        {mode==="moderator"&&<TOrders orders={orders} setOrders={setOrders} tenant={tenant} onTopup={()=>setTopupOpen(true)} role="moderator" mobile={mobile}/>}
      </div>
    </div>

    {topupOpen&&<TopupModal tenant={tenant} onClose={()=>setTopupOpen(false)} onDone={handleTopup}/>}
    {toast&&<Toast msg={toast.msg} ok={toast.ok} onDone={()=>setToast(null)}/>}
  </>);
}
