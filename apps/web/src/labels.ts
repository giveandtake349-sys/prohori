// Bangla labels for the MVP web client.
export const CATEGORY_BN: Record<string, string> = {
  khun: 'খুন',
  ghum: 'গুম / নিখোঁজ',
  churi: 'চুরি',
  dakati: 'ডাকাতি',
  dhorshon: 'ধর্ষণ',
  eveteasing: 'ইভটিজিং',
  madok: 'মাদক',
  durniti: 'দুর্নীতি',
  other: 'অন্যান্য',
};

export const STATUS_BN: Record<string, string> = {
  submitted: 'প্রকাশিত · যাচাই বাকি',
  verifying: 'যাচাই চলছে',
  verified: 'যাচাইকৃত',
  forwarded: 'থানায় পাঠানো',
  investigating: 'তদন্ত চলছে',
  resolved: 'সমাধান হয়েছে',
  rejected: 'বাতিল',
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_BN);
