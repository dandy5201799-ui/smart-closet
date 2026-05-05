
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon' | 'black';
  fullWidth?: boolean;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  fullWidth = false, 
  isLoading = false,
  className = '',
  disabled,
  ...props 
}) => {
  // 基础样式：Pill shape, 自适应宽度, 字体适中
  const baseStyles = "relative inline-flex items-center justify-center px-6 py-3 rounded-full font-medium text-[15px] tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none";
  
  const variants = {
    // 极简主义主按钮：纯黑背景，白色文字，无阴影或微弱阴影
    primary: "bg-stone-900 text-white hover:bg-black border border-transparent shadow-md shadow-stone-900/10",
    // 极简 AI 按钮：品牌色
    black: "bg-black text-white hover:bg-stone-800 shadow-sm",
    // 次要按钮：纯白背景，极细灰边框
    secondary: "bg-white text-stone-800 border border-stone-200 hover:bg-stone-50 shadow-sm",
    // 幽灵按钮
    ghost: "bg-transparent text-stone-500 hover:text-stone-900 hover:bg-stone-100/50",
    // 图标按钮
    icon: "p-3 rounded-full aspect-square flex items-center justify-center"
  };

  return (
    <button 
      className={`
        ${baseStyles} 
        ${variants[variant]} 
        ${fullWidth ? 'w-full flex' : ''} 
        ${className}
      `}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading ? (
        <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : children}
    </button>
  );
};
