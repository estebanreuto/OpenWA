import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Languages } from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';
import { CustomSelect } from '../components/CustomSelect';
import { languageOptions, resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import { API_BASE_URL } from '../services/api';
import type { AuthCredential } from '../utils/authStorage';
import './Login.css';

interface LoginProps {
  onLogin: (credential: AuthCredential, role?: string, engineType?: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const { t, i18n } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'apiKey' | 'password'>('apiKey');
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(false);
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [setupEngineType, setSetupEngineType] = useState<string | undefined>();
  const [setupUsername, setSetupUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);

  useEffect(() => {
    fetch(`${API_BASE_URL}/auth/dashboard-config`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => setPasswordLoginEnabled(data?.passwordLoginEnabled === true))
      .catch(() => setPasswordLoginEnabled(false));
  }, []);

  const changeLanguage = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The stored key is matched against key prefixes elsewhere, so a pasted space must not reach it.
    setIsLoading(true);
    setError('');

    try {
      if (setupKey) {
        if (password.length < 12) {
          setError(t('login.passwordTooShort'));
          return;
        }
        if (password !== confirmPassword) {
          setError(t('login.passwordMismatch'));
          return;
        }
        const response = await fetch(`${API_BASE_URL}/auth/dashboard-credentials`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': setupKey },
          body: JSON.stringify({ username: setupUsername.trim(), password }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setError(errorData.message || t('login.setupFailed'));
          return;
        }
        onLogin({ type: 'apiKey', value: setupKey, rememberMe }, 'admin', setupEngineType);
        return;
      }

      if (mode === 'password') {
        const response = await fetch(`${API_BASE_URL}/auth/dashboard-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password, rememberMe }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setError(errorData.message || t('login.invalidCredentials'));
          return;
        }
        const data: { token: string; role?: string; engineType?: string } = await response.json();
        onLogin(
          { type: 'dashboardSession', value: data.token, rememberMe },
          data.role,
          typeof data.engineType === 'string' ? data.engineType : undefined,
        );
        return;
      }

      const key = apiKey.trim();
      if (!key) {
        setError(t('login.apiKeyRequired'));
        return;
      }
      const response = await fetch(`${API_BASE_URL}/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
      });

      if (response.ok) {
        // The validate body already carries the key's role — hand it up so the app can set it
        // directly instead of re-validating the same key a second time.
        const data: { role?: string; engineType?: string } = await response.json().catch(() => ({}));
        const configResponse = await fetch(`${API_BASE_URL}/auth/dashboard-config`);
        const config = configResponse.ok ? await configResponse.json() : null;
        if (data.role === 'admin' && config?.passwordLoginEnabled !== true) {
          setSetupKey(key);
          setSetupEngineType(typeof data.engineType === 'string' ? data.engineType : undefined);
          setSetupUsername('admin');
          setPassword('');
          setConfirmPassword('');
          return;
        }
        onLogin(
          { type: 'apiKey', value: key, rememberMe },
          data.role,
          typeof data.engineType === 'string' ? data.engineType : undefined,
        );
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.message || t('login.invalidKey'));
      }
    } catch {
      setError(t('login.connectionError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <img src="/openwa_logo.webp" alt="OpenWA" className="logo-icon" />
          <span className="version-info">
            {t('login.version', {
              version: __APP_VERSION__,
              // ISO date (YYYYMMDD) so the format is stable across locales/regions instead of the
              // locale-dependent toLocaleDateString() which renders differently per browser region.
              date: new Date(__BUILD_TIME__).toISOString().slice(0, 10).replace(/-/g, ''),
            })}
          </span>
        </div>

        <div className="login-language">
          <Languages size={18} />
          <CustomSelect
            value={currentLang}
            onChange={value => changeLanguage(value as SupportedLanguage)}
            options={languageOptions.map(opt => ({ value: opt.value, label: opt.label }))}
            ariaLabel={t('common.language')}
          />
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {setupKey ? (
            <>
              <h2 className="login-setup-title">{t('login.setupTitle')}</h2>
              <p className="login-setup-description">{t('login.setupDescription')}</p>
              <div className="input-group">
                <label htmlFor="setupUsername">{t('common.username')}</label>
                <input
                  id="setupUsername"
                  type="text"
                  autoComplete="username"
                  minLength={3}
                  maxLength={100}
                  value={setupUsername}
                  onChange={e => setSetupUsername(e.target.value)}
                  className={error ? 'error' : ''}
                  required
                />
              </div>
              <div className="input-group">
                <label htmlFor="setupPassword">{t('login.newPassword')}</label>
                <div className="input-wrapper">
                  <input
                    id="setupPassword"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={error ? 'error' : ''}
                    required
                  />
                  <button
                    type="button"
                    className="toggle-visibility"
                    onClick={() => setShowKey(!showKey)}
                    aria-label={showKey ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              <div className="input-group">
                <label htmlFor="confirmPassword">{t('login.confirmPassword')}</label>
                <input
                  id="confirmPassword"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={error ? 'error' : ''}
                  required
                />
                {error && <span className="error-message">{error}</span>}
              </div>
              <label className="remember-row">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                <span>{t('login.rememberMe')}</span>
              </label>
              <button type="submit" className="connect-btn" disabled={isLoading}>
                {isLoading ? t('login.connecting') : t('login.saveLogin')}
              </button>
              <button type="button" className="login-skip-btn" onClick={() => setSetupKey(null)}>
                {t('login.skipSetup')}
              </button>
            </>
          ) : (
            <>
              {passwordLoginEnabled && (
                <div className="login-methods" role="group" aria-label={t('login.methodLabel')}>
                  <button type="button" className={mode === 'apiKey' ? 'active' : ''} onClick={() => setMode('apiKey')}>
                    {t('login.methodApiKey')}
                  </button>
                  <button
                    type="button"
                    className={mode === 'password' ? 'active' : ''}
                    onClick={() => setMode('password')}
                  >
                    {t('login.methodPassword')}
                  </button>
                </div>
              )}

              {mode === 'apiKey' ? (
                <div className="input-group">
                  <label htmlFor="apiKey">{t('login.apiKey')}</label>
                  <div className="input-wrapper">
                    <input
                      id="apiKey"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={t('login.apiKeyPlaceholder')}
                      className={error ? 'error' : ''}
                    />
                    <button
                      type="button"
                      className="toggle-visibility"
                      onClick={() => setShowKey(!showKey)}
                      aria-label={showKey ? t('common.hideApiKey') : t('common.showApiKey')}
                    >
                      {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  {error && <span className="error-message">{error}</span>}
                </div>
              ) : (
                <>
                  <div className="input-group">
                    <label htmlFor="dashboardUsername">{t('common.username')}</label>
                    <input
                      id="dashboardUsername"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className={error ? 'error' : ''}
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="dashboardPassword">{t('common.password')}</label>
                    <div className="input-wrapper">
                      <input
                        id="dashboardPassword"
                        type={showKey ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className={error ? 'error' : ''}
                      />
                      <button
                        type="button"
                        className="toggle-visibility"
                        onClick={() => setShowKey(!showKey)}
                        aria-label={showKey ? t('login.hidePassword') : t('login.showPassword')}
                      >
                        {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    {error && <span className="error-message">{error}</span>}
                  </div>
                </>
              )}

              <label className="remember-row">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                <span>{t('login.rememberMe')}</span>
              </label>

              <button type="submit" className="connect-btn" disabled={isLoading}>
                {isLoading ? t('login.connecting') : t('login.connect')}
              </button>
            </>
          )}
        </form>

        <p className="login-help">
          {t('login.help')}{' '}
          <a href="https://docs.open-wa.org" target="_blank" rel="noopener noreferrer">
            {t('login.viewDocs')}
          </a>
        </p>
      </div>

      <footer className="login-footer">
        <span>{t('login.footer')}</span>
        <a
          href="https://github.com/rmyndharis/OpenWA"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          aria-label="GitHub"
        >
          <GithubIcon size={18} />
        </a>
      </footer>
    </div>
  );
}
