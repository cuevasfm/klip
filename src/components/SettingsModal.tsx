import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Moon, Sun, Globe } from 'lucide-react';
import { invoke } from "@tauri-apps/api/core";
import clsx from 'clsx';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'dark' | 'light';
    setTheme: (theme: 'dark' | 'light') => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, theme, setTheme }) => {
    const { t, i18n } = useTranslation();
    const [retentionDays, setRetentionDays] = useState<string>("90");

    useEffect(() => {
        if (isOpen) {
            invoke('get_setting', { key: 'retention_days' })
                .then((val: unknown) => {
                    setRetentionDays((val as string) || "90");
                })
                .catch(console.error);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
    };

    const handleRetentionChange = (days: string) => {
        setRetentionDays(days);
        invoke('set_setting', { key: 'retention_days', value: days })
            .catch(console.error);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div
                className={clsx(
                    "w-96 rounded-lg shadow-xl border p-6 transform transition-all",
                    theme === 'dark' ? "bg-[#252526] border-[#333] text-gray-200" : "bg-white border-gray-200 text-gray-800"
                )}
            >
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        {t('settings')}
                    </h2>
                    <button
                        onClick={onClose}
                        className={clsx("p-1 rounded-md hover:bg-opacity-20", theme === 'dark' ? "hover:bg-gray-400" : "hover:bg-gray-200")}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Theme Section */}
                <div className="mb-6">
                    <label className="block text-sm font-medium mb-3 opacity-80">{t('theme')}</label>
                    <div className="flex gap-2 bg-opacity-10 bg-gray-500 p-1 rounded-lg">
                        <button
                            onClick={() => setTheme('light')}
                            className={clsx(
                                "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm transition-all",
                                theme === 'light'
                                    ? "bg-white text-gray-900 shadow"
                                    : "text-gray-400 hover:text-gray-200 hover:bg-white/10"
                            )}
                        >
                            <Sun className="w-4 h-4" />
                            {t('light')}
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={clsx(
                                "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm transition-all",
                                theme === 'dark'
                                    ? "bg-[#3c3c3c] text-white shadow"
                                    : "text-gray-600 hover:text-gray-900 hover:bg-black/5"
                            )}
                        >
                            <Moon className="w-4 h-4" />
                            {t('dark')}
                        </button>
                    </div>
                </div>

                {/* Retention Section */}
                <div className="mb-6">
                    <label className="block text-sm font-medium mb-3 opacity-80">{t('retention')}</label>
                    <div className="grid grid-cols-3 gap-2">
                        {["30", "60", "90"].map((days) => (
                            <button
                                key={days}
                                onClick={() => handleRetentionChange(days)}
                                className={clsx(
                                    "flex items-center justify-center py-2 rounded-md text-sm transition-all border",
                                    retentionDays === days
                                        ? (theme === 'dark' ? "bg-[#37373d] border-blue-500 text-white" : "bg-blue-50 border-blue-500 text-blue-900")
                                        : (theme === 'dark' ? "bg-[#2d2d2d] border-transparent hover:bg-[#37373d]" : "bg-gray-50 border-transparent hover:bg-gray-100")
                                )}
                            >
                                {days} {t('days')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Language Section */}
                <div className="mb-6">
                    <label className="block text-sm font-medium mb-3 opacity-80">{t('language')}</label>
                    <div className="space-y-2">
                        <button
                            onClick={() => changeLanguage('en')}
                            className={clsx(
                                "w-full flex items-center justify-between px-4 py-3 rounded-md text-sm transition-all border",
                                i18n.language.startsWith('en')
                                    ? (theme === 'dark' ? "bg-[#37373d] border-blue-500 text-white" : "bg-blue-50 border-blue-500 text-blue-900")
                                    : (theme === 'dark' ? "bg-[#2d2d2d] border-transparent hover:bg-[#37373d]" : "bg-gray-50 border-transparent hover:bg-gray-100")
                            )}
                        >
                            <span className="flex items-center gap-2"><Globe className="w-4 h-4" /> {t('english')}</span>
                            {i18n.language.startsWith('en') && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </button>
                        <button
                            onClick={() => changeLanguage('es')}
                            className={clsx(
                                "w-full flex items-center justify-between px-4 py-3 rounded-md text-sm transition-all border",
                                i18n.language.startsWith('es')
                                    ? (theme === 'dark' ? "bg-[#37373d] border-blue-500 text-white" : "bg-blue-50 border-blue-500 text-blue-900")
                                    : (theme === 'dark' ? "bg-[#2d2d2d] border-transparent hover:bg-[#37373d]" : "bg-gray-50 border-transparent hover:bg-gray-100")
                            )}
                        >
                            <span className="flex items-center gap-2"><Globe className="w-4 h-4" /> {t('spanish')}</span>
                            {i18n.language.startsWith('es') && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </button>
                    </div>
                </div>

                {/* About Section */}
                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium mb-2 opacity-80">{t('about_klip')}</h3>
                    <div className="text-sm opacity-60 space-y-1">
                        <p>{t('about_klip_text')}</p>
                        <p>{t('about_klip_email')}</p>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SettingsModal;
