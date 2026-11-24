import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUiStore = create(
  persist(
    (set) => ({
      theme: 'light', // 'light' (padrao premium) ou 'dark'
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'dark' ? 'light' : 'dark'
      })),
      setTheme: (theme) => set({ theme }),
      // Menu lateral no computador: aberto (240px, com nomes) ou recolhido
      // (68px, so icones). Abre e fecha por clique e empurra a tela, nunca cobre.
      menuAberto: true,
      alternarMenu: () => set((state) => ({ menuAberto: !state.menuAberto })),
    }),
    {
      name: 'sellergy-ui-storage',
    }
  )
);
