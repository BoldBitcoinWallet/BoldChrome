export const themes = {
	lightPolished: {
		colors: {
			primary: '#2E7D32',
			subPrimary: '#1B5E20',
			secondary: '#4CAF50',
			accent: '#FFC107',
			background: '#F5F5F5',
			text: '#212121',
			textSecondary: '#757575',
			cardBackground: '#FFFFFF',
			disabled: '#BDBDBD',
			border: '#E0E0E0',
			success: '#4CAF50',
			error: '#F44336',
			warning: '#FFA000',
			textOnPrimary: '#FFFFFF',
			shadowColor: '#000000',
		}
	},
	darkPolished: {
		colors: {
			primary: '#1B5E20',
			subPrimary: '#2E7D32',
			secondary: '#388E3C',
			accent: '#FFA000',
			background: '#121212',
			text: '#FFFFFF',
			textSecondary: '#B0B0B0',
			cardBackground: '#1E1E1E',
			disabled: '#424242',
			border: '#333333',
			success: '#388E3C',
			error: '#D32F2F',
			warning: '#FFA000',
			textOnPrimary: '#FFFFFF',
			shadowColor: '#000000',
		}
	}
};

function setVars(colors: {[key: string]: string}) {
	const root = typeof document !== 'undefined' ? document.documentElement.style : null;
	if (!root) return;
	Object.entries(colors).forEach(([k, v]) => {
		root.setProperty(`--color-${k}`, v);
	});
}

export function applyTheme(name: 'lightPolished' | 'darkPolished' = 'lightPolished') {
	const theme = themes[name] || themes.lightPolished;
	setVars(theme.colors);
}
