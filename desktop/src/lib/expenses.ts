import type { ExpenseCategory } from './types';

export const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'licences', label: 'Licences' },
  { value: 'travel', label: 'Travel' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'subcontractors', label: 'Subcontractors' },
  { value: 'other', label: 'Other' },
];

export function categoryLabel(category: string): string {
  return EXPENSE_CATEGORIES.find((item) => item.value === category)?.label ?? category;
}
