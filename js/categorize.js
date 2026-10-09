// Product / expense text → category.
//
// One classifier shared by every way of entering an expense: typing in Add
// Expense or Quick Add, the voice entry, and scanned receipts. It looks at
// the words of the note (product names, shops, services), in this order:
//
//   1. the user's own history — a note they categorised before ("gym" →
//      Healthcare) wins over any built-in guess;
//   2. the user's custom category names ("Pets" for "dog food");
//   3. a large vocabulary of products, brands and services (below), scored
//      per category, with light typo tolerance for voice / typing slips.
//
// Pure functions (no DOM) so they're unit-testable.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
// Words in WEAK are real signals but ambiguous on their own ("ticket" could be
// a movie or a bus), so they count for less and never beat a clear product.

export const CATEGORY_WORDS = {
  cat_food: [
    "restaurant", "cafe", "café", "coffee", "tea", "chai", "latte", "cappuccino", "espresso", "dine", "dining", "dine-in", "dinner", "lunch",
    "breakfast", "brunch", "snack", "meal", "tiffin", "thali", "kitchen", "biryani", "biriyani", "pizza", "burger", "sandwich", "paneer", "naan",
    "roti", "chapati", "paratha", "dosa", "idli", "vada", "uttapam", "sambar", "poha", "upma", "samosa", "kachori", "pav bhaji", "vada pav",
    "chaat", "pani puri", "golgappa", "bhel", "momos", "noodles", "chowmein", "manchurian", "fried rice", "pasta", "curry", "dal makhani",
    "chicken", "mutton", "fish", "egg roll", "kebab", "tikka", "shawarma", "wrap", "roll", "fries", "wings", "nuggets", "soup", "salad", "starter",
    "main course", "combo", "veg", "non-veg", "dessert", "ice cream", "icecream", "gelato", "kulfi", "cake", "pastry", "brownie", "donut", "cookie",
    "bakery", "sweets", "mithai", "jalebi", "gulab jamun", "lassi", "juice", "shake", "milkshake", "smoothie", "mocktail", "cocktail", "soda",
    "cola", "coke", "pepsi", "sprite", "beer", "wine", "whisky", "whiskey", "vodka", "rum", "liquor", "pub", "bar", "brewery", "canteen", "mess",
    "dhaba", "hotel", "swiggy", "zomato", "ubereats", "dominos", "domino", "pizza hut", "mcdonald", "mcdonalds", "kfc", "burger king", "subway",
    "starbucks", "ccd", "barista", "chaayos", "haldiram", "haldirams", "faasos", "behrouz", "box8", "food", "foodie", "takeaway", "takeout",
    "saravana", "bhavan", "sagar", "udupi", "darshini", "tandoori", "buffet", "cafeteria", "eatery", "bistro", "diner", "patisserie",
  ],
  cat_groceries: [
    "supermarket", "super market", "hypermarket", "mart", "dmart", "d-mart", "bigbasket", "big bazaar", "bazaar", "blinkit", "zepto", "instamart",
    "jiomart", "grocery", "groceries", "kirana", "provision", "provisions", "ration", "atta", "flour", "maida", "sugar", "salt", "oil", "ghee",
    "milk", "curd", "yogurt", "butter", "cheese", "eggs", "egg", "bread", "vegetable", "vegetables", "veggies", "sabzi", "sabji", "onion", "potato",
    "tomato", "garlic", "ginger", "fruit", "fruits", "banana", "apple", "orange", "mango", "grapes", "rice", "basmati", "dalia", "pulses", "masoor",
    "toor", "moong", "chana", "rajma", "spices", "masala", "turmeric", "jeera", "biscuit", "biscuits", "chips", "namkeen", "maggi", "cereal", "oats",
    "detergent", "surf", "soap", "shampoo", "toothpaste", "handwash", "dishwash", "tissue", "toilet paper", "napkin", "sanitary", "garbage bag",
    "floor cleaner", "harpic", "vim", "ariel", "tide", "reliance fresh", "spencer", "star bazaar", "nature's basket", "lulu", "more supermarket",
    "household", "cleaning", "dry fruits", "nuts", "honey", "tea powder", "coffee powder", "pet food",
  ],
  cat_transport: [
    "petrol", "diesel", "fuel", "cng", "petrol pump", "gas station", "hp", "bpcl", "iocl", "indian oil", "indianoil", "shell", "nayara", "essar",
    "bharat petroleum", "hindustan petroleum", "petroleum", "nozzle", "ltrs", "litre", "liter", "toll", "fastag", "parking", "uber", "ola", "rapido",
    "cab", "taxi", "auto", "autorickshaw", "rickshaw", "fare", "metro", "bus", "irctc", "railway", "local train", "train", "garage", "car wash",
    "puncture", "tyre", "tire", "mechanic", "bike service", "car service", "oil change", "challan", "ride", "commute", "transport", "redbus",
    "bounce", "yulu", "dmrc", "ev charging", "service station", "blusmart", "meru", "namma yatri",
  ],
  cat_health: [
    "pharmacy", "pharma", "medical", "medicals", "medicos", "medicine", "medicines", "chemist", "drug", "drugs", "tablet", "tablets", "tab", "tabs",
    "capsule", "syrup", "strip", "ointment", "cream", "paracetamol", "dolo", "crocin", "antibiotic", "injection", "vaccine", "doctor", "dr", "hospital",
    "clinic", "consultation", "checkup", "check-up", "lab test", "blood test", "diagnostic", "diagnostics", "pathology", "xray", "x-ray", "mri",
    "ct scan", "ultrasound", "dental", "dentist", "eye", "optician", "optical", "spectacles", "glasses", "lens", "lenses", "lenskart", "physio",
    "physiotherapy", "therapy", "therapist", "gym", "fitness", "yoga", "zumba", "vitamin", "vitamins", "supplement", "supplements", "protein",
    "apollo", "medplus", "netmeds", "pharmeasy", "1mg", "practo", "cult", "cultfit", "ayurvedic", "homeopathy", "surgery", "ambulance", "sanitizer",
    "bandage", "wellness", "health", "healthcare", "spa", "massage",
  ],
  cat_shopping: [
    "shopping", "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "tata cliq", "mall", "clothes", "clothing", "apparel", "garment", "garments",
    "shirt", "tshirt", "t-shirt", "jeans", "trouser", "trousers", "pants", "shorts", "dress", "saree", "kurta", "kurti", "lehenga", "jacket", "hoodie",
    "sweater", "socks", "innerwear", "shoes", "sneakers", "sandal", "sandals", "slippers", "footwear", "bag", "backpack", "wallet", "belt", "watch",
    "sunglasses", "jewellery", "jewelry", "ring", "necklace", "earrings", "perfume", "cosmetic", "cosmetics", "makeup", "skincare", "lipstick",
    "electronics", "mobile", "phone", "smartphone", "iphone", "samsung", "oneplus", "laptop", "tv", "television", "fridge", "refrigerator",
    "washing machine", "mixer", "grinder", "microwave", "oven", "headphone", "headphones", "earphone", "earphones", "earbuds", "airpods", "charger",
    "power bank", "keyboard", "mouse", "camera", "speaker", "smartwatch", "console", "ps5", "xbox", "furniture", "sofa", "bed", "mattress", "chair",
    "table", "curtain", "curtains", "decor", "home decor", "ikea", "pepperfry", "utensil", "utensils", "crockery", "toy", "toys", "lego", "cricket",
    "bat", "ball", "football", "badminton", "racket", "racquet", "tennis", "hockey", "cycle", "bicycle", "skateboard", "sports", "sportswear",
    "yoga mat", "dumbbell", "dumbbells", "treadmill", "helmet", "decathlon", "croma", "reliance digital", "vijay sales", "fashion", "lifestyle",
    "westside", "pantaloons", "zara", "h&m", "trends", "boutique", "tailor", "stitching", "umbrella", "luggage bag", "pet", "dog", "aquarium",
  ],
  cat_entertainment: [
    "cinema", "pvr", "inox", "movie", "movies", "film", "ticket", "tickets", "bookmyshow", "multiplex", "popcorn", "concert", "show", "theatre", "theater",
    "event", "gaming", "game", "games", "steam", "playstation", "pubg", "valorant", "bowling", "arcade", "amusement", "water park", "club", "nightclub",
    "karaoke", "comedy", "stand-up", "netflix", "spotify", "hotstar", "disney", "zee5", "sonyliv", "youtube premium", "apple music", "jiosaavn", "gaana",
    "prime video", "amazon prime", "prime", "ott", "audible", "subscription", "party", "magic show", "circus", "fair", "carnival", "zoo", "museum",
  ],
  cat_utilities: [
    "electricity", "electric", "power bill", "bescom", "msedcl", "tneb", "tata power", "adani electricity", "discom", "units consumed", "kwh", "meter",
    "water bill", "water supply", "water tanker", "gas bill", "lpg", "cylinder", "gas cylinder", "indane", "bharatgas", "hp gas", "piped gas", "mgl",
    "igl", "municipal", "property tax", "dth", "tata sky", "tata play", "dish tv", "d2h", "cable", "newspaper", "utility", "utilities", "generator",
  ],
  cat_internet: [
    "internet", "wifi", "wi-fi", "broadband", "fibre", "fiber", "airtel", "jio", "jiofiber", "vodafone", "vi", "bsnl", "recharge", "postpaid", "prepaid",
    "data pack", "mobile bill", "phone bill", "sim", "act fibernet", "hathway", "mobile recharge", "roaming",
  ],
  cat_travel: [
    "flight", "flights", "airline", "airlines", "airfare", "indigo", "air india", "spicejet", "vistara", "akasa", "resort", "lodge", "lodging",
    "guest house", "homestay", "airbnb", "oyo", "makemytrip", "mmt", "goibibo", "yatra", "cleartrip", "ixigo", "booking.com", "trip", "tour", "travel",
    "travels", "holiday", "vacation", "visa", "passport", "cruise", "safari", "sightseeing", "stay", "room", "check-in", "checkin", "hotel booking",
    "airport", "baggage", "forex", "trek", "trekking", "camping", "hostel",
  ],
  cat_education: [
    "school", "college", "university", "tuition", "coaching", "class", "classes", "course", "courses", "udemy", "coursera", "unacademy", "byjus",
    "vedantu", "fees", "fee", "exam", "admission", "books", "book", "notebook", "stationery", "stationary", "library", "certification", "training",
    "workshop", "webinar", "textbook", "uniform", "duolingo", "skillshare", "edx", "upgrad", "pen", "pencil", "test series",
  ],
  cat_gifts: [
    "gift", "gifts", "gifting", "present", "birthday", "anniversary", "flowers", "bouquet", "florist", "donation", "donate", "charity", "temple", "church",
    "mosque", "gurudwara", "ngo", "shagun", "return gift", "greeting card", "wedding gift", "chocolate box", "hamper",
  ],
  cat_housing: [
    "rent", "house rent", "flat rent", "room rent", "pg", "maintenance", "society", "apartment", "mortgage", "housing", "property", "broker",
    "brokerage", "security deposit", "plumber", "plumbing", "electrician", "carpenter", "painter", "paint", "cement", "repair", "renovation",
    "maid", "househelp", "cook salary", "watchman", "hardware", "pest control", "furnishing",
  ],
  cat_loans: [
    "emi", "loan", "instalment", "installment", "credit card bill", "credit card", "card payment", "personal loan", "home loan", "car loan", "bajaj finance",
    "late fee", "penalty", "interest", "bnpl", "lazypay", "simpl", "kreditbee",
  ],
  cat_investments: [
    "investment", "invest", "stocks", "stock", "shares", "mutual fund", "sip", "zerodha", "groww", "upstox", "angel one", "fd", "fixed deposit", "rd",
    "ppf", "nps", "epf", "gold", "silver", "bitcoin", "crypto", "ethereum", "etf", "bonds", "demat", "digital gold", "gold coin",
  ],
};

// Receipt-only context words (they mean little in a typed note but a lot on a bill).
const RECEIPT_EXTRA = {
  cat_food: ["kot", "waiter", "steward", "service charge", "covers", "table no"],
  cat_transport: ["nozzle", "volume", "rate/ltr"],
  cat_health: ["batch", "expiry", "exp", "mrp tab"],
};
for (const [id, words] of Object.entries(RECEIPT_EXTRA)) CATEGORY_WORDS[id].push(...words);

/** Real words, but ambiguous on their own — counted at half weight. */
const WEAK = new Set([
  "ticket", "tickets", "bag", "cap", "tab", "tabs", "dr", "exp", "lab", "pen", "book", "books", "room", "stay", "show", "event", "game", "games", "party",
  "club", "fair", "table", "bed", "chair", "ring", "watch", "auto", "ride", "fare", "train", "bus", "cream", "oil", "salt", "sugar", "rice", "dal", "egg",
  "eggs", "bar", "mess", "roll", "wrap", "main course", "hotel", "hostel", "prime", "subscription", "fee", "fees", "class", "classes", "interest",
  "property", "paint", "repair", "mobile", "phone", "eye", "health", "wellness", "protein", "cycle", "ball", "bat", "pet", "dog", "mart", "vi", "hp",
  "tea", "coffee", "shell", "service", "mouse", "meter", "electric", "water", "gas", "sim", "stock", "shares", "gold", "silver", "tour", "trip", "travel",
]);

// Words that are ONLY tie-breakers when a stronger signal exists.
const STRONG_OVERRIDES = {
  // "bat", "ball", "cricket" are shopping (sports goods) in an expense note.
  cricket: "cat_shopping", bat: "cat_shopping", ball: "cat_shopping",
};

// Order used to break exact ties (most common categories first).
const CATEGORY_ORDER = [
  "cat_food", "cat_groceries", "cat_transport", "cat_shopping", "cat_health", "cat_entertainment", "cat_utilities", "cat_internet",
  "cat_travel", "cat_education", "cat_housing", "cat_gifts", "cat_loans", "cat_investments",
];

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

const singleIndex = new Map();   // single word → [{ id, weight }]
const phraseList = [];           // multi-word entries
{
  for (const id of CATEGORY_ORDER) {
    for (const raw of CATEGORY_WORDS[id] || []) {
      const word = raw.replace(/\?$/, "").toLowerCase();
      const weight = WEAK.has(word) ? 0.5 : 1;
      const isPhrase = /[\s]/.test(word);
      if (isPhrase) {
        phraseList.push({ id, word, weight: weight + 0.5 });
      } else {
        if (!singleIndex.has(word)) singleIndex.set(word, []);
        singleIndex.get(word).push({ id, weight });
      }
    }
  }
  for (const [word, id] of Object.entries(STRONG_OVERRIDES)) {
    singleIndex.set(word, [{ id, weight: 1 }]);
  }
}
const singleWords = [...singleIndex.keys()];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const STOP = new Set([
  "the", "and", "for", "with", "from", "was", "were", "paid", "pay", "bought", "buy", "got", "get", "spent", "spend", "new", "old", "some", "one",
  "two", "three", "bill", "bills", "payment", "expense", "rupees", "rupee", "rs", "inr", "cash", "upi", "card", "this", "that", "my", "our", "a", "an",
  "of", "to", "in", "on", "at", "by", "is", "it", "me", "today", "yesterday", "monthly", "month", "total", "amount", "purchase", "order",
]);

export function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9&+\-.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalizeText(text)
    .replace(/[&+]/g, " ")
    .split(/[\s]+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

/** Plural / simple suffix variants so "burgers", "biscuits", "taxis" match. */
function variants(token) {
  const out = [token];
  if (token.endsWith("ies") && token.length > 4) out.push(token.slice(0, -3) + "y");
  if (token.endsWith("es") && token.length > 4) out.push(token.slice(0, -2));
  if (token.endsWith("s") && token.length > 3) out.push(token.slice(0, -1));
  if (token.endsWith("ing") && token.length > 5) out.push(token.slice(0, -3));
  return out;
}

function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Typo-tolerant lookup for longer words ("biriyani" → "biryani", "pizzza"). */
function fuzzyLookup(token) {
  if (token.length < 5) return null;
  for (const w of singleWords) {
    if (w.length < 5 || w[0] !== token[0]) continue;
    if (withinOneEdit(token, w)) return singleIndex.get(w);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function lexiconScores(text) {
  const norm = normalizeText(text);
  const scores = {};
  const hits = {};
  const add = (id, word, weight) => {
    scores[id] = (scores[id] || 0) + weight;
    (hits[id] = hits[id] || new Set()).add(word);
  };
  const padded = ` ${norm} `;
  for (const p of phraseList) {
    if (padded.includes(` ${p.word} `) || padded.includes(` ${p.word}s `)) add(p.id, p.word, p.weight);
  }
  const seen = new Set();
  for (const tok of tokens(text)) {
    let entries = null;
    let matchedWord = tok;
    for (const v of variants(tok)) {
      if (singleIndex.has(v)) { entries = singleIndex.get(v); matchedWord = v; break; }
    }
    if (!entries) entries = fuzzyLookup(tok);
    if (!entries || seen.has(matchedWord + tok)) continue;
    seen.add(matchedWord + tok);
    for (const e of entries) add(e.id, matchedWord, e.weight);
  }
  return { scores, hits };
}

function pickBest(scores) {
  let best = null;
  let top = 0;
  let second = 0;
  for (const id of CATEGORY_ORDER) {
    const s = scores[id] || 0;
    if (s > top) { second = top; top = s; best = id; }
    else if (s > second) second = s;
  }
  return { best, top, second };
}

// ---------------------------------------------------------------------------
// History + custom categories
// ---------------------------------------------------------------------------

function fromHistory(text, expenses, categoryIds) {
  const norm = normalizeText(text);
  if (!norm || !Array.isArray(expenses) || expenses.length === 0) return null;

  // Exact same note before → trust it.
  const exact = {};
  const tokenVotes = {};
  const toks = tokens(text).filter((t) => t.length >= 3 && !STOP.has(t));
  for (const e of expenses) {
    if (!e || !e.note || !e.categoryId || !categoryIds.has(e.categoryId)) continue;
    const n = normalizeText(e.note);
    if (n === norm) exact[e.categoryId] = (exact[e.categoryId] || 0) + 1;
    else if (toks.length) {
      const nt = new Set(tokens(e.note));
      for (const t of toks) if (nt.has(t)) {
        (tokenVotes[t] = tokenVotes[t] || {})[e.categoryId] = ((tokenVotes[t] || {})[e.categoryId] || 0) + 1;
      }
    }
  }
  const topOf = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (Object.keys(exact).length) {
    const [id, n] = topOf(exact);
    return { categoryId: id, confidence: "high", matched: [norm], source: "history", strength: 10 + n };
  }
  // A distinctive word the user has categorised consistently (≥2 times, all one category).
  let best = null;
  for (const [t, counts] of Object.entries(tokenVotes)) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const [id, n] = topOf(counts);
    if (total >= 2 && n === total && (!best || total > best.total)) best = { id, total, t };
  }
  if (best) return { categoryId: best.id, confidence: "medium", matched: [best.t], source: "history", strength: 3 };
  return null;
}

function fromCategoryNames(text, categories) {
  const toks = new Set(tokens(text).flatMap(variants));
  for (const c of categories) {
    if (c.isDefault) continue; // defaults are covered by the vocabulary
    const words = tokens(c.name).filter((w) => w.length >= 3 && !STOP.has(w)).flatMap(variants);
    const hit = words.find((w) => toks.has(w));
    if (hit) return { categoryId: c.id, confidence: "high", matched: [hit], source: "name", strength: 8 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify free text (a note, a product name, a voice transcript…).
 *
 * @param {string} text
 * @param {object} [ctx]
 * @param {Array<{id:string,name:string,isDefault?:boolean}>} [ctx.categories]
 *        the user's categories; when given, only these ids are returned and
 *        custom category names are matched.
 * @param {Array<{note?:string,categoryId?:string}>} [ctx.expenses] past expenses
 * @param {boolean} [ctx.fallbackOther] return "Other" (low confidence) when nothing matches
 * @returns {{ categoryId: string, confidence: "high"|"medium"|"low", matched: string[], source: string } | null}
 */
export function classifyText(text, ctx = {}) {
  const { categories = null, expenses = null, fallbackOther = false } = ctx;
  if (!normalizeText(text)) return null;
  const ids = categories ? new Set(categories.map((c) => c.id)) : null;
  const allowed = (id) => !ids || ids.has(id);

  const history = ids ? fromHistory(text, expenses, ids) : null;
  if (history && history.confidence === "high") return history;

  const named = categories ? fromCategoryNames(text, categories) : null;
  if (named) return named;

  const { scores, hits } = lexiconScores(text);
  // Drop categories the user doesn't have, so the next-best can win.
  for (const id of Object.keys(scores)) if (!allowed(id)) delete scores[id];
  const { best, top, second } = pickBest(scores);

  if (history && (!best || top < 1.5)) return history;
  if (best && top >= 0.5) {
    const confidence = top >= 1.5 && top >= second * 1.5 ? "high" : top >= 1 ? "medium" : "low";
    return { categoryId: best, confidence, matched: [...(hits[best] || [])].slice(0, 5), source: "keywords" };
  }
  if (fallbackOther && allowed("cat_other")) {
    return { categoryId: "cat_other", confidence: "low", matched: [], source: "fallback" };
  }
  return null;
}

/** Old API: { id, word } or null. */
export function suggestCategoryFromText(text, ctx = {}) {
  const r = classifyText(text, ctx);
  return r ? { id: r.categoryId, word: r.matched[0] || "" } : null;
}
