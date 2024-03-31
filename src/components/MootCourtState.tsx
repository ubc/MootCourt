import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
// import type {} from '@redux-devtools/extension' // required for devtools typing

interface MootCourtState {
//   bears: number
//   increase: (by: number) => void
  subtitles: string 
  setSubtitles: (newSubtitles: string) => void
}


export const useMootCourtStore = create<MootCourtState>()(
  devtools(
    persist(
      (set) => ({
        // bears: 0,
        // increase: (by) => set((state) => ({ bears: state.bears + by })),
        subtitles: '',
        setSubtitles: (newSubtitles) => set((state) => ({ subtitles: newSubtitles }))
      }),
      {
        name: 'mootcourt-storage',
      },
    ),
  ),
)

