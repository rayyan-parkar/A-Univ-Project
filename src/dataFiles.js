// Keep the experiment file contract in one place for the browser and Node paths.
export const REQUIRED_FILES = Object.freeze([
    'VibrationData.txt',
    'VibrationData_FPGA.txt',
    'SphericalData_low.txt',
    'SphericalData_medium.txt',
    'SphericalData_high.txt',
    'CommunicationData_low.txt',
    'CommunicationData_medium.txt',
    'CommunicationData_high.txt'
]);

export const FILE_GROUPS = Object.freeze({
    waveform: Object.freeze(['VibrationData.txt', 'VibrationData_FPGA.txt']),
    vector: Object.freeze(['SphericalData_low.txt', 'SphericalData_medium.txt', 'SphericalData_high.txt']),
    communication: Object.freeze(['CommunicationData_low.txt', 'CommunicationData_medium.txt', 'CommunicationData_high.txt'])
});
