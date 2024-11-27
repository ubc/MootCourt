import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
// import type {} from '@redux-devtools/extension' // required for devtools typing

interface MootCourtState {
    //   bears: number
    //   increase: (by: number) => void
    subtitles: string
    setSubtitles: (newSubtitles: string) => void
    isInputLocked: boolean // Add a state for the input lock
    setInputLock: (locked: boolean) => void // Add an action to toggle the lock
}


export const useMootCourtStore = create<MootCourtState>()(
    devtools(
        persist(
            (set) => ({
                // bears: 0,
                // increase: (by) => set((state) => ({ bears: state.bears + by })),
                subtitles: '',
                setSubtitles: (newSubtitles) => set((state) => ({ subtitles: newSubtitles })),
                isInputLocked: false, // Initialize the input lock as false
                setInputLock: (locked) => set(() => ({ isInputLocked: locked })),
            }),
            {
                name: 'mootcourt-storage',
            },
        ),
    ),
)

