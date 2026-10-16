import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  CATEGORY_BN, CATEGORY_EN,
  STATUS_BN, STATUS_EN,
  LEVEL_BN, LEVEL_EN,
  PETITION_STATUS_BN, PETITION_STATUS_EN,
  GENDER_BN, GENDER_EN,
  TIER_BN, TIER_EN,
} from './labels';

export type Lang = 'bn' | 'en';
const STORAGE_KEY = 'prohori-lang';

/** Core UI strings. Default language is Bangla. */
const STRINGS: Record<string, { bn: string; en: string }> = {
  tagline: { bn: 'জনতার চোখ — অপরাধ দেখলে চুপ নয়', en: 'Eyes of the people — never silent about crime' },
  nav_report: { bn: 'রিপোর্ট করুন', en: 'Report' },
  nav_teams: { bn: 'পাশে আছি টিম', en: 'Pashe Achi teams' },
  nav_scorecard: { bn: 'থানা স্কোরকার্ড', en: 'Thana scorecard' },
  nav_dabi: { bn: 'দাবি', en: 'Demands' },
  nav_fraud: { bn: 'নম্বর যাচাই', en: 'Verify number' },
  nav_missing: { bn: 'নিখোঁজ', en: 'Missing' },
  nav_trends: { bn: 'ট্রেন্ড', en: 'Trends' },
  nav_hotspots: { bn: 'হটস্পট ম্যাপ', en: 'Hotspot map' },
  nav_moderate: { bn: 'মডারেশন', en: 'Moderation' },
  loading: { bn: 'লোড হচ্ছে…', en: 'Loading…' },
  back_home: { bn: '← হোম', en: '← Home' },
  all: { bn: 'সব', en: 'All' },
  no_reports: { bn: 'এখনো কোনো রিপোর্ট নেই।', en: 'No reports yet.' },
  server_down: { bn: 'সার্ভার পাওয়া যাচ্ছে না — API চালু আছে তো?', en: 'Cannot reach server — is the API running?' },
  // Report form
  report_h: { bn: 'অপরাধ রিপোর্ট করুন', en: 'Report a crime' },
  f_category: { bn: 'অপরাধের ধরন', en: 'Crime type' },
  f_title: { bn: 'শিরোনাম', en: 'Title' },
  f_title_ph: { bn: 'যেমন: মিরপুর ১০-এ দোকানে চুরি', en: 'e.g. Shop burglary in Mirpur 10' },
  f_desc: { bn: 'বিবরণ', en: 'Description' },
  f_desc_ph: { bn: 'কী ঘটেছে, কখন, কীভাবে — বিস্তারিত লিখুন (সর্বনিম্ন ১০ অক্ষর)', en: 'What happened, when, how — in detail (min 10 characters)' },
  f_voice_hint: { bn: '— মাইকে চাপ দিয়ে বলেও লিখতে পারেন', en: '— or tap the mic and speak' },
  f_listening: { bn: '🎙️ শুনছি… বাংলায় বলুন', en: '🎙️ Listening… speak now' },
  f_datetime: { bn: 'ঘটনার তারিখ ও সময় (ঐচ্ছিক)', en: 'Date & time of incident (optional)' },
  f_address: { bn: 'ঠিকানা (এলাকা/মহল্লা)', en: 'Address (area/moholla)' },
  f_address_ph: { bn: 'যেমন: মিরপুর ১০, ব্লক সি, ঢাকা', en: 'e.g. Mirpur 10, Block C, Dhaka' },
  f_location: { bn: 'ঘটনার স্থান — ম্যাপে চিহ্নিত করুন *', en: 'Incident location — pin it on the map *' },
  f_my_location: { bn: 'আমার বর্তমান অবস্থান', en: 'Use my current location' },
  f_locating: { bn: 'লোকেশন নেওয়া হচ্ছে…', en: 'Getting location…' },
  f_anonymous: { bn: 'নাম গোপন রাখুন (anonymous রিপোর্ট)', en: 'Keep me anonymous' },
  f_submit: { bn: 'রিপোর্ট জমা দিন', en: 'Submit report' },
  f_submitting: { bn: 'জমা হচ্ছে…', en: 'Submitting…' },
  // 2-tier verification (commit 7)
  tier_progress: { bn: 'আরও {n} জন যাচাই করলে "জনতা যাচাইকৃত" হবে', en: '{n} more verifications needed for community verification' },
  accused_label: { bn: 'অভিযুক্ত', en: 'Accused' },
  accused_hidden: { bn: 'অভিযুক্তের পরিচয় গোপন রাখা হয়েছে — অফিসিয়াল যাচাইয়ের পর প্রকাশ হবে', en: 'Accused identity withheld until official verification' },
  f_accused: { bn: 'অভিযুক্তের নাম (ঐচ্ছিক — সংবেদনশীল কেসে)', en: 'Accused name (optional — sensitive cases)' },
  f_accused_ph: { bn: 'জানা থাকলে লিখুন — অফিসিয়াল যাচাইয়ের আগে পাবলিক হবে না', en: 'If known — stays private until official verification' },
  // Case page
  case_unresolved: { bn: 'এই ঘটনা এখনো অমীমাংসিত', en: 'This case is still unresolved' },
  case_resolved: { bn: 'এই ঘটনার সমাধান হয়েছে ✓', en: 'This case has been resolved ✓' },
  share_case: { bn: 'কেসটি শেয়ার করুন', en: 'Share this case' },
  copy_link: { bn: 'লিংক কপি', en: 'Copy link' },
  copied: { bn: 'কপি হয়েছে ✓', en: 'Copied ✓' },
  // Missing board
  missing_h: { bn: 'নিখোঁজ ব্যক্তি বোর্ড', en: 'Missing persons board' },
  missing_only: { bn: 'শুধু নিখোঁজ', en: 'Missing only' },
  missing_all: { bn: 'সব দেখুন', en: 'Show all' },
  missing_found: { bn: 'খুঁজে পাওয়া গেছে ✓', en: 'Found ✓' },
  // Trends
  trends_h: { bn: 'অপরাধ ট্রেন্ড', en: 'Crime trends' },
  // Moderate
  moderate_h: { bn: 'মডারেশন প্যানেল', en: 'Moderation panel' },
  confirmed_by: { bn: 'জন নিশ্চিত করেছে', en: 'people confirmed' },
  evidence_attached: { bn: 'টি প্রমাণ সংযুক্ত', en: 'evidence items attached' },
  progress: { bn: 'অগ্রগতি', en: 'Progress' },
  // Moderator panel
  mod_login_h: { bn: 'মডারেটর লগইন', en: 'Moderator login' },
  mod_login_ph: { bn: 'তোমার user ID (uuid)', en: 'Your user ID (uuid)' },
  mod_login_btn: { bn: 'প্রবেশ', en: 'Enter' },
  mod_not_allowed: { bn: 'এই পেজ শুধু মডারেটর/অ্যাডমিনদের জন্য।', en: 'This page is for moderators/admins only.' },
  mod_queue: { bn: 'যাচাই queue', en: 'Review queue' },
  mod_users: { bn: 'ব্যবহারকারী', en: 'Users' },
  mod_verify: { bn: 'যাচাই করো ✓', en: 'Verify ✓' },
  mod_reject: { bn: 'বাতিল করো', en: 'Reject' },
  mod_evidence: { bn: 'আরো প্রমাণ চাও', en: 'Request evidence' },
  mod_escalate: { bn: 'এসকেলেট', en: 'Escalate' },
  mod_reason_ph: { bn: 'কারণ লিখো (আবশ্যক)', en: 'Reason (required)' },
  mod_note_ph: { bn: 'নোট (ঐচ্ছিক)', en: 'Note (optional)' },
  mod_level_ph: { bn: 'যেমন: থানা ব্যবস্থা নেয়নি → এসপি অফিসে পাঠানো হলো', en: 'e.g. Thana took no action → sent to SP office' },
  mod_history: { bn: 'ইতিহাস', en: 'History' },
  mod_map: { bn: 'ম্যাপ', en: 'Map' },
  mod_similar: { bn: 'সদৃশ রিপোর্ট', en: 'Similar reports' },
  mod_pending: { bn: 'অপেক্ষমাণ', en: 'Pending' },
  mod_verified_today: { bn: 'আজ যাচাই', en: 'Verified today' },
  mod_rejected_today: { bn: 'আজ বাতিল', en: 'Rejected today' },
  mod_avg_verify: { bn: 'গড় যাচাই (ঘণ্টা)', en: 'Avg verify (hrs)' },
  mod_confirm_verify: { bn: 'এই রিপোর্ট যাচাই করবে? পাবলিক ফিডে যাবে + ৫ কি.মি. অ্যালার্ট যাবে।', en: 'Verify this report? It will go public + 5km alert.' },
  mod_urgent: { bn: 'জরুরি', en: 'Urgent' },
  mod_save: { bn: 'পাঠাও', en: 'Send' },
  // New pages
  scorecard_h: { bn: 'থানা স্কোরকার্ড', en: 'Thana scorecard' },
  scorecard_sub: { bn: 'কোন থানা কত দ্রুত ব্যবস্থা নিচ্ছে — পাবলিক র‍্যাঙ্কিং। স্কোর: ৪০% সমাধান + ৩০% ব্যবস্থা + ৩০% দ্রুততা।', en: 'Which thana acts fastest — public ranking. Score: 40% resolution + 30% action + 30% responsiveness.' },
  scorecard_empty: { bn: 'এখনো কোনো স্কোরকার্ড নেই।', en: 'No scorecards yet.' },
  scorecard_verified_reports: { bn: 'যাচাইকৃত রিপোর্ট', en: 'verified reports' },
  scorecard_resolved: { bn: 'সমাধান', en: 'resolved' },
  scorecard_formula: { bn: 'স্কোর = ৪০% সমাধান হার + ৩০% ব্যবস্থার হার + ৩০% দ্রুততা (যাচাই থেকে সমাধান)।', en: 'Score = 40% resolution rate + 30% action rate + 30% responsiveness (verify to resolve).' },
  scorecard_not_found: { bn: 'থানা পাওয়া যায়নি।', en: 'Thana not found.' },
  scorecard_total: { bn: 'মোট রিপোর্ট', en: 'Total reports' },
  scorecard_resolution: { bn: 'সমাধান হার', en: 'Resolution rate' },
  scorecard_action_taken: { bn: 'ব্যবস্থা নেওয়া', en: 'Action taken' },
  scorecard_no_action: { bn: 'ব্যবস্থা হয়নি', en: 'No action' },
  scorecard_avg_hours: { bn: 'গড় যাচাই→সমাধান (ঘণ্টা)', en: 'Avg verify→resolve (hrs)' },
  scorecard_recent: { bn: 'সাম্প্রতিক যাচাইকৃত রিপোর্ট', en: 'Recently verified reports' },
  scorecard_no_reports: { bn: 'এই থানায় যাচাইকৃত রিপোর্ট নেই।', en: 'No verified reports for this thana.' },
  score_no_data: { bn: 'তথ্য নেই', en: 'No data' },
  dabi_login_needed: { bn: 'দাবি তুলতে বা স্বাক্ষর করতে সাইন ইন করুন।', en: 'Sign in to create or sign demands.' },
  dabi_active: { bn: 'চলমান দাবি', en: 'Active demands' },
  dabi_h: { bn: 'দাবি (পিটিশন)', en: 'Demands (petitions)' },
  dabi_sub: { bn: 'স্বাক্ষর জমাও — লক্ষ্য পূরণ হলে দাবি থানা → এসপি → ডিআইজি পর্যন্ত এসকেলেট হবে।', en: 'Add your signature — when the goal is met, the demand escalates thana → SP → DIG.' },
  dabi_empty: { bn: 'এখনো কোনো দাবি নেই। প্রথম দাবিটি তুলুন!', en: 'No demands yet. Start the first one!' },
  dabi_new: { bn: '+ নতুন দাবি', en: '+ New demand' },
  dabi_title_label: { bn: 'দাবির শিরোনাম', en: 'Demand title' },
  dabi_title_ph: { bn: 'যেমন: মিরপুরে স্ট্রিট লাইট চাই', en: 'e.g. Street lights needed in Mirpur' },
  dabi_desc_label: { bn: 'বিস্তারিত', en: 'Details' },
  dabi_desc_ph: { bn: 'কেন এই দাবি, কী ব্যবস্থা চান…', en: 'Why this demand, what action you want…' },
  dabi_threshold: { bn: 'লক্ষ্য স্বাক্ষর', en: 'Signature goal' },
  dabi_create: { bn: 'দাবি তৈরি করুন', en: 'Create demand' },
  dabi_creating: { bn: 'তৈরি হচ্ছে…', en: 'Creating…' },
  dabi_sign: { bn: '✊ স্বাক্ষর করুন', en: '✊ Sign' },
  dabi_signing: { bn: '…', en: '…' },
  dabi_sign_need: { bn: 'স্বাক্ষর করতে সাইন ইন করুন', en: 'Sign in to add your signature' },
  dabi_signed: { bn: '✓ স্বাক্ষর হয়েছে', en: '✓ Signed' },
  dabi_share: { bn: 'শেয়ার', en: 'Share' },
  dabi_share_copied: { bn: 'শেয়ার টেক্সট কপি হয়েছে!', en: 'Share text copied!' },
  dabi_escalated: { bn: 'এসকেলেটেড', en: 'Escalated' },
  dabi_level: { bn: 'পর্যায়', en: 'Level' },
  dabi_status: { bn: 'অবস্থা', en: 'Status' },
  dabi_progress: { bn: 'অগ্রগতি', en: 'Progress' },
  dabi_link_report: { bn: 'রিপোর্ট লিংক (ঐচ্ছিক)', en: 'Link a report (optional)' },
  dabi_report_ph: { bn: 'ট্র্যাকিং আইডি, যেমন PRH-ABC123', en: 'Tracking ID, e.g. PRH-ABC123' },
  level_thana: { bn: 'থানা', en: 'Thana' },
  level_sp: { bn: 'এসপি', en: 'SP' },
  level_dig: { bn: 'ডিআইজি', en: 'DIG' },
  status_active: { bn: 'চলমান', en: 'Active' },
  status_escalated: { bn: 'এসকেলেটেড', en: 'Escalated' },
  status_closed: { bn: 'বন্ধ', en: 'Closed' },
  nearby_h: { bn: 'এই এলাকার সাম্প্রতিক অপরাধ', en: 'Recent crime in this area' },
  nearby_loading: { bn: 'আশেপাশের তথ্য আনা হচ্ছে…', en: 'Loading nearby history…' },
  nearby_found: { bn: 'গত ৩০ দিনে ১ কি.মি. এর মধ্যে', en: 'within 1 km in the last 30 days' },
  nearby_none: { bn: 'গত ৩০ দিনে ১ কি.মি. এর মধ্যে যাচাইকৃত অপরাধ নেই।', en: 'No verified crimes within 1 km in the last 30 days.' },
  nearby_hint: { bn: 'পিন সরালে তথ্য আপডেট হবে।', en: 'Move the pin to update.' },
  missing_sub: { bn: 'কাউকে খুঁজছেন? বোর্ডে পোস্ট করুন — পাওয়া গেলে "পাওয়া গেছে" চিহ্ন দিন।', en: 'Looking for someone? Post on the board — mark "found" when located.' },
  missing_empty: { bn: 'এই তালিকায় কেউ নেই।', en: 'Nobody on this list.' },
  missing_found_label: { bn: '✓ পাওয়া গেছে', en: '✓ Found' },
  missing_tab_missing: { bn: 'নিখোঁজ', en: 'Missing' },
  missing_tab_found: { bn: 'পাওয়া গেছে', en: 'Found' },
  missing_new: { bn: '+ নতুন পোস্ট', en: '+ New post' },
  missing_name: { bn: 'নাম *', en: 'Name *' },
  missing_age: { bn: 'বয়স', en: 'Age' },
  missing_gender: { bn: 'লিঙ্গ', en: 'Gender' },
  missing_photo: { bn: 'ছবির URL (ঐচ্ছিক)', en: 'Photo URL (optional)' },
  missing_lastseen: { bn: 'শেষ দেখা (স্থান)', en: 'Last seen (place)' },
  missing_lastseen_ph: { bn: 'যেমন: গুলিস্তান বাসস্ট্যান্ড', en: 'e.g. Gulistan bus stand' },
  missing_date: { bn: 'শেষ দেখার তারিখ', en: 'Date last seen' },
  missing_contact: { bn: 'যোগাযোগের নম্বর *', en: 'Contact number *' },
  missing_contact_hint: { bn: 'এই নম্বর পাবলিক থাকবে — খুঁজে পেলে এই নম্বরে জানানো হবে।', en: 'This number stays public — finders will call it.' },
  missing_submit: { bn: 'পোস্ট করুন', en: 'Post' },
  missing_submitting: { bn: 'পোস্ট হচ্ছে…', en: 'Posting…' },
  missing_mark_found: { bn: 'পাওয়া গেছে', en: 'Mark found' },
  missing_found_confirm: { bn: 'নিশ্চিত — ব্যক্তিটি পাওয়া গেছে?', en: 'Confirm — the person has been found?' },
  gender_male: { bn: 'পুরুষ', en: 'Male' },
  gender_female: { bn: 'নারী', en: 'Female' },
  gender_other: { bn: 'অন্যান্য', en: 'Other' },
  trends_sub: { bn: 'গত ৩০ দিন — শুধু যাচাইকৃত রিপোর্ট (জনতা + প্রহরী)।', en: 'Last 30 days — verified reports only (community + official).' },
  trends_days: { bn: 'দৈনিক', en: 'Daily' },
  trends_verified: { bn: 'যাচাইকৃত', en: 'Verified' },
  trends_resolved: { bn: 'সমাধান', en: 'Resolved' },
  trends_by_category: { bn: 'ধরন অনুযায়ী', en: 'By category' },
  trends_no_data: { bn: 'এখনো ট্রেন্ড তথ্য নেই।', en: 'No trend data yet.' },
  case_not_found: { bn: 'কেস পাওয়া যায়নি।', en: 'Case not found.' },
  case_share: { bn: 'কেস শেয়ার করুন', en: 'Share this case' },
  case_copied: { bn: 'লিংক কপি হয়েছে!', en: 'Link copied!' },
  case_open_app: { bn: 'প্রহরী অ্যাপে দেখুন', en: 'Open in Prohori app' },
  mod_stats_pending: { bn: 'অপেক্ষমাণ', en: 'Pending' },
  mod_audit: { bn: 'মডারেশন লগ', en: 'Moderation log' },
  mod_no_audit: { bn: 'কোনো মডারেশন অ্যাকশন নেই।', en: 'No moderation actions yet.' },
  mod_users_hint: { bn: 'শুধু অ্যাডমিন: citizen / volunteer / moderator রোল দিন। admin রোল এখানে বদলানো যায় না।', en: 'Admin only: assign citizen / volunteer / moderator roles. The admin role cannot be changed here.' },
  mod_role: { bn: 'রোল', en: 'Role' },
  mod_role_set: { bn: 'রোল আপডেট হয়েছে', en: 'Role updated' },
  mod_role_cannot_self: { bn: 'নিজের রোল বদলানো যায় না।', en: 'You cannot change your own role.' },
  mod_role_protected: { bn: 'admin রোল সুরক্ষিত — এখানে বদলানো যায় না।', en: 'The admin role is protected and cannot be changed here.' },
  role_citizen: { bn: 'নাগরিক', en: 'Citizen' },
  role_volunteer: { bn: 'স্বেচ্ছাসেবক', en: 'Volunteer' },
  role_moderator: { bn: 'মডারেটর', en: 'Moderator' },
  role_admin: { bn: 'অ্যাডমিন', en: 'Admin' },
  lang_toggle: { bn: 'EN', en: 'বাং' },
  textarea: { bn: 'শেয়ার টেক্সট', en: 'Share text' },
};

const LABEL_TABLES: Record<string, Record<Lang, Record<string, string>>> = {
  category: { bn: CATEGORY_BN, en: CATEGORY_EN },
  status: { bn: STATUS_BN, en: STATUS_EN },
  level: { bn: LEVEL_BN, en: LEVEL_EN },
  petition_status: { bn: PETITION_STATUS_BN, en: PETITION_STATUS_EN },
  gender: { bn: GENDER_BN, en: GENDER_EN },
  tier: { bn: TIER_BN, en: TIER_EN },
};

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  label: (table: keyof typeof LABEL_TABLES, key: string) => string;
}

const Ctx = createContext<LangCtx>({
  lang: 'bn',
  setLang: () => {},
  t: (k) => STRINGS[k]?.bn ?? k,
  label: () => '',
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Lang) === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode */
    }
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = (l: Lang) => setLangState(l);
  const t = (key: string) => STRINGS[key]?.[lang] ?? key;
  const label = (table: keyof typeof LABEL_TABLES, key: string) =>
    LABEL_TABLES[table]?.[lang]?.[key] ?? key;
  return <Ctx.Provider value={{ lang, setLang, t, label }}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}

/** Floating Bangla/English toggle, rendered once at the app root. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      className="lang-toggle"
      onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
      aria-label="Switch language / ভাষা বদলান"
      title="বাংলা / English"
    >
      {lang === 'bn' ? 'EN' : 'বাং'}
    </button>
  );
}
