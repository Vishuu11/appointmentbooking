import React from 'react';

export default function Badge({ variant = 'default', className = '', ...props }) {
  return <span className={`badge ${variant} ${className}`} {...props} />;
}
