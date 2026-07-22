import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Room from './pages/Room'
import Practice from './pages/Practice'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:code" element={<Room />} />
        <Route path="/practice" element={<Practice />} />
      </Routes>
      <Toaster position="top-center" richColors />
    </>
  )
}
