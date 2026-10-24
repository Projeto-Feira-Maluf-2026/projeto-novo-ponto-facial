import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, LIST_MAX_PAGES, LIST_PAGE_CONCURRENCY, LIST_PAGE_SIZE } from './api';

const response = (page: number, total: number) => ({ data: {
  page, total, size: LIST_PAGE_SIZE,
  items: Array.from({ length: Math.max(0, Math.min(LIST_PAGE_SIZE, total - (page - 1) * LIST_PAGE_SIZE)) },
    (_, index) => ({ id: String((page - 1) * LIST_PAGE_SIZE + index) })),
} });

describe('paginação concorrente limitada', () => {
  it('não busca outras páginas para listas pequenas ou vazias', async () => {
    for (const total of [0, 15, LIST_PAGE_SIZE]) {
      const get = vi.fn(async (page: number) => response(page, total));
      expect((await fetchAllPages(get)).data.items).toHaveLength(total);
      expect(get).toHaveBeenCalledTimes(1);
    }
  });

  it('busca em paralelo com limite e mantém ordem mesmo com respostas invertidas', async () => {
    const total = LIST_PAGE_SIZE * 7 + 3;
    let active = 0;
    let maximum = 0;
    const get = vi.fn(async (page: number) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, (4 - page % 3) * 2));
      active -= 1;
      return response(page, total);
    });
    const { data } = await fetchAllPages(get);
    expect(maximum).toBe(LIST_PAGE_CONCURRENCY);
    expect(data.items.map(({ id }) => Number(id))).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(get).toHaveBeenCalledTimes(8);
  });

  it('preserva deduplicação e informa total quando o limite torna a lista parcial', async () => {
    const total = LIST_PAGE_SIZE * (LIST_MAX_PAGES + 2);
    const get = vi.fn(async (page: number) => {
      const result = response(page, total);
      if (page === 2) result.data.items[0] = { id: '0' };
      return result;
    });
    const { data } = await fetchAllPages(get);
    expect(get).toHaveBeenCalledTimes(LIST_MAX_PAGES);
    expect(data.items).toHaveLength(LIST_MAX_PAGES * LIST_PAGE_SIZE - 1);
    expect(data.total).toBe(total);
  });

  it('propaga falha sem devolver uma lista parcial como completa', async () => {
    const get = vi.fn(async (page: number) => {
      if (page === 3) throw new Error('sem permissão');
      return response(page, 1000);
    });
    await expect(fetchAllPages(get)).rejects.toThrow('sem permissão');
    expect(get).toHaveBeenCalledTimes(4);
  });
});
