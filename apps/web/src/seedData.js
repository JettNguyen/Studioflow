export const demoProjects = [
    {
        id: 'proj-1',
        title: 'Neon Skyline EP',
        description: 'Late-night alt-pop sessions with layered vocals and analog synths.',
        genre: 'Alt Pop',
        songCount: 4,
        collaboratorCount: 3
    },
    {
        id: 'proj-2',
        title: 'Velvet Room Singles',
        description: 'R&B drop series focused on vocal textures and stripped percussion.',
        genre: 'R&B',
        songCount: 2,
        collaboratorCount: 4
    }
];
export const demoProjectDetails = [
    {
        id: 'proj-1',
        title: 'Neon Skyline EP',
        description: 'Main campaign project for Q2 releases.',
        driveSyncStatus: 'Healthy',
        songs: [
            { id: 'song-1', title: 'Afterglow', status: 'In Progress', assetCount: 12, taskOpenCount: 3 },
            { id: 'song-2', title: 'Midnight Circuit', status: 'Draft', assetCount: 7, taskOpenCount: 1 }
        ]
    }
];
export const demoSongWorkspace = [
    {
        id: 'song-1',
        title: 'Afterglow',
        key: 'D Minor',
        bpm: 124,
        assets: [
            { id: 'asset-1', name: 'Lead Vocal Main', type: 'WAV Stem', duration: '03:24' },
            { id: 'asset-2', name: 'Harmony Stack', type: 'WAV Stem', duration: '03:24' },
            { id: 'asset-3', name: 'Rough Mix v6', type: 'MP3 Mix', duration: '03:26' }
        ],
        notes: [
            { id: 'note-1', author: 'Jett', body: 'Need brighter vocal at pre-chorus.' },
            { id: 'note-2', author: 'Ari', body: 'Take 3 adlibs feel strongest, keep these.' }
        ],
        tasks: [
            { id: 'task-1', title: 'Print revised chorus vocal', assignee: 'Ari', status: 'Open' },
            { id: 'task-2', title: 'Bounce social teaser clip', assignee: 'Jett', status: 'In Review' }
        ]
    }
];
