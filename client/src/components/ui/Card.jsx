import React from 'react';

export default function Card({ className = '', ...props }) {
  return <div className={`card ${className}`} {...props} />;
}
