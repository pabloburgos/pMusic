// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';

afterEach(() => {
  cleanup();
});

describe('@pmusic/web UI', () => {
  it('renders pMusic shell without errors, displays Home & Explorar shelves, opens Spotlight Search, and navigates to Buscar and Biblioteca', async () => {
    render(<App />);
    expect(screen.getAllByText(/Buenos días|Buenas tardes|Buenas noches/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mixes para ti/i).length).toBeGreaterThan(0);

    const exploreTab = screen.getAllByRole('tab', { name: /Explorar/i })[0]!;
    fireEvent.click(exploreTab);
    expect(screen.getByText(/Explorar géneros/i)).toBeDefined();

    const searchTab = screen.getAllByRole('tab', { name: /Buscar/i })[0]!;
    fireEvent.click(searchTab);
    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toBeDefined();
    expect(screen.getByText(/Búsquedas recientes/i)).toBeDefined();

    fireEvent.change(searchInput, { target: { value: 'Quevedo' } });
    fireEvent.submit(searchInput.closest('form')!);
    expect(screen.getByTestId('best-result-card')).toBeDefined();

    const libTab = screen.getAllByRole('tab', { name: /Biblioteca/i })[0]!;
    fireEvent.click(libTab);
    expect(screen.getAllByText(/Tus Playlists/i).length).toBeGreaterThan(0);
  });

  it('opens categorized SettingsModal, switches themes & dock styles, explores audio/discord tabs, and opens DJ & EQ popovers from dock', () => {
    render(<App />);
    const header = document.querySelector('header');
    expect(header?.querySelector('button[aria-label="Ajustes"]')).toBeNull();

    fireEvent.click(screen.getByTestId('dock-dj-btn'));
    expect(screen.getByTestId('dj-popover')).toBeDefined();
    expect(screen.getByTestId('dj-style-quick')).toBeDefined();
    expect(screen.getByTestId('dj-style-full')).toBeDefined();

    fireEvent.click(screen.getByTestId('dock-eq-btn'));
    expect(screen.queryByTestId('dj-popover')).toBeNull();
    expect(screen.getByTestId('eq-sheet')).toBeDefined();
    fireEvent.click(screen.getByTestId('dock-eq-btn'));

    const settingsBtn = screen.getAllByRole('button', { name: /Ajustes/i })[0]!;
    fireEvent.click(settingsBtn);

    expect(screen.getByTestId('settings-view')).toBeDefined();
    expect(screen.getByTestId('settings-category-apariencia')).toBeDefined();
    expect(screen.getByTestId('settings-category-audio')).toBeDefined();
    expect(screen.getByTestId('settings-category-discord')).toBeDefined();

    fireEvent.click(screen.getByTestId('theme-card-nordic-light'));
    expect(document.documentElement.dataset.theme).toBe('nordic-light');

    const liquidGlassToggle = screen.getByTestId('liquid-glass-toggle');
    fireEvent.click(liquidGlassToggle);
    expect(document.documentElement.classList.contains('pm-solid-modern')).toBe(true);
    expect(document.documentElement.classList.contains('pm-liquid-glass-all')).toBe(false);
    fireEvent.click(liquidGlassToggle);
    expect(document.documentElement.classList.contains('pm-liquid-glass-all')).toBe(true);
    expect(document.documentElement.classList.contains('pm-solid-modern')).toBe(false);

    const ambientCard = screen.getByTestId('dock-style-ambient-dock');
    const classicCard = screen.getByTestId('dock-style-classic-center');
    const islandCard = screen.getByTestId('dock-style-floating-island');
    const minimalCard = screen.getByTestId('dock-style-minimal-wave');
    fireEvent.click(ambientCard);
    expect(ambientCard.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(islandCard);
    expect(islandCard.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(minimalCard);
    expect(minimalCard.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(classicCard);
    expect(classicCard.getAttribute('aria-pressed')).toBe('true');

    expect(screen.queryByTestId('settings-category-gustos')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-category-cuenta'));
    expect(screen.queryByLabelText('Supabase Project URL')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tu cuenta pMusic' })).toBeDefined();

    fireEvent.click(screen.getByTestId('settings-category-discord'));
    expect(screen.getByRole('heading', { name: 'Discord Rich Presence' })).toBeDefined();

    fireEvent.click(screen.getByTestId('settings-category-apariencia'));
    fireEvent.click(screen.getByTestId('theme-card-obsidian'));
    fireEvent.click(screen.getByRole('button', { name: /Cerrar ajustes/i }));
  });

  it('renders each collaborating artist independently via ArtistLinks', () => {
    render(
      <ArtistLinks
        artists={[
          { id: 'ar-1', name: 'Bad Bunny' },
          { id: 'ar-2', name: 'Bomba Estéreo' },
          { id: 'ar-3', name: 'Dei V' },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: /Ir al artista Bad Bunny/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Ir al artista Bomba Estéreo/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Ir al artista Dei V/i })).toBeDefined();
  });
});
