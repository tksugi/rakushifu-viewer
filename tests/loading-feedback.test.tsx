import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Loading, Result, StartupLoading } from '../frontend/ui';
import { Login } from '../frontend/Login';

afterEach(cleanup);

describe('graphical loading feedback', () => {
  it('shows no text or actions during React startup, then restores the login and sample actions', () => {
    const view = render(<StartupLoading label="画面を読み込み中" />);
    expect(screen.getByRole('status', { name: '画面を読み込み中' })).toBeTruthy();
    expect(document.body.textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
    view.rerender(<Login />);
    const login = screen.getByRole('button', { name: 'ログイン' });
    const sample = screen.getByRole('link', { name: 'ログインなしでサンプルを試す' });
    expect(sample.getAttribute('href')).toBe('/sample');
    expect(login.compareDocumentPosition(sample) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('shows a skeleton without visible waiting text and names the state for screen readers', () => {
    render(<Loading label="読み込み中" />);
    const status = screen.getByRole('status', { name: '読み込み中' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('');
    expect(document.body.textContent).toBe('');
  });

  it('keeps cached content usable while a text-free spinner indicates refresh, then removes it', () => {
    const action = vi.fn();
    const state = { value: { synthetic: true }, error: null, isFetching: true, refetch: vi.fn() };
    const view = render(<Result state={state}><button onClick={action}>取得済みの内容</button></Result>);
    expect(screen.getByRole('status', { name: '更新中' }).textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '取得済みの内容' }));
    expect(action).toHaveBeenCalledOnce();
    expect(document.body.textContent).toBe('取得済みの内容');
    view.rerender(<Result state={{ ...state, isFetching: false }}><button onClick={action}>取得済みの内容</button></Result>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '取得済みの内容' })).toBeTruthy();
  });

  it('keeps failure messages and the retry action visible', () => {
    const retry = vi.fn();
    render(<Result state={{ value: undefined, error: new Error('架空の通信エラー'), isFetching: false, refetch: retry }}>{null}</Result>);
    expect(screen.getByRole('status').textContent).toContain('架空の通信エラー');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
