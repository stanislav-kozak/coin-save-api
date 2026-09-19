export interface DefaultCategorySeed {
  name: string;
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: Record<'uk' | 'en', DefaultCategorySeed[]> = {
  uk: [
    { name: 'Продукти', icon: '🛒', color: '#F97350' },
    { name: 'Транспорт', icon: '🚌', color: '#3B82F6' },
    { name: 'Комуналка', icon: '💡', color: '#EAB308' },
    { name: 'Кафе', icon: '☕', color: '#A855F7' },
    { name: 'Розваги', icon: '🎬', color: '#EC4899' },
    { name: "Здоров'я", icon: '💊', color: '#16A34A' },
  ],
  en: [
    { name: 'Groceries', icon: '🛒', color: '#F97350' },
    { name: 'Transport', icon: '🚌', color: '#3B82F6' },
    { name: 'Utilities', icon: '💡', color: '#EAB308' },
    { name: 'Restaurants', icon: '☕', color: '#A855F7' },
    { name: 'Entertainment', icon: '🎬', color: '#EC4899' },
    { name: 'Health', icon: '💊', color: '#16A34A' },
  ],
};
