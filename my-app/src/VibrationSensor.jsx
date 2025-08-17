import {useState, useEffect} from 'react';
import { ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Legend} from 'chart.js';
import { Line } from 'react-chartjs-2';
import './VibrationSensor.css';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

function VibrationChart([latestData, maxDataPoints]) {

}