export const fmt = (n) => Math.round(n).toLocaleString('en-US')
export const money = (n) => '$' + Math.round(n).toLocaleString('en-US')
export const pad = (n) => String(n).padStart(2, '0')
