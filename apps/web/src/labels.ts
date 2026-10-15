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

export const TIER_BN: Record<string, string> = {
  none: 'যাচাই হয়নি',
  community: 'জনতা যাচাইকৃত',
  official: 'প্রহরী যাচাইকৃত',
};

export const CATEGORY_EN: Record<string, string> = {
  khun: 'Murder',
  ghum: 'Disappearance',
  churi: 'Theft',
  dakati: 'Robbery',
  dhorshon: 'Rape',
  eveteasing: 'Eve teasing',
  madok: 'Drugs',
  durniti: 'Corruption',
  other: 'Other',
};

export const STATUS_EN: Record<string, string> = {
  submitted: 'Submitted',
  verifying: 'Verifying',
  verified: 'Verified',
  forwarded: 'Sent to police',
  investigating: 'Investigating',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

export const TIER_EN: Record<string, string> = {
  none: 'Unverified',
  community: 'Community verified',
  official: 'Officially verified',
};

export const LEVEL_BN: Record<string, string> = {
  thana: 'থানা',
  sp: 'এসপি',
  dig: 'ডিআইজি',
};

export const LEVEL_EN: Record<string, string> = {
  thana: 'Thana',
  sp: 'SP',
  dig: 'DIG',
};

export const PETITION_STATUS_BN: Record<string, string> = {
  active: 'চলমান',
  escalated: 'এসকেলেটেড',
  closed: 'বন্ধ',
};

export const PETITION_STATUS_EN: Record<string, string> = {
  active: 'Active',
  escalated: 'Escalated',
  closed: 'Closed',
};

export const GENDER_BN: Record<string, string> = {
  male: 'পুরুষ',
  female: 'নারী',
  other: 'অন্যান্য',
};

export const GENDER_EN: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
};
