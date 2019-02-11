﻿using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using DG.Tweening;
using Scene;
using Network;
using Game;
using Models;
using UnityEngine.SceneManagement;

public class StartBtn : MonoBehaviour
{

    [SerializeField]
    private float duration;
    private bool isActivated = false;

    private void Awake()
    {
        gameObject.GetComponent<Button>().onClick.AddListener(OnClicked);
        GameServer.instance.ConfedEvent += Check;
    }

    private void OnDestroy()
    {
        GameServer.instance.ConfedEvent -= Check;
    }

    private void Start()
    {
        if(GameServer.instance.connectedRoom!=null)
            Check(GameServer.instance.connectedRoom.conf);
    }
    
    private void Check(Conf conf)
    {
        User me = LobbyServer.instance.loginUser;
        if (conf.king == me.id && conf.black != -1 && conf.white != -1)
        {
            Active();
        }
        else
        {
            UnActive();
        }
    }

    private void Active()
    {
        isActivated = true;
        gameObject.transform.GetComponent<RectTransform>().DOPivot(new Vector2(1,0), duration);
    }

    private void UnActive()
    {
        isActivated = false;
        gameObject.transform.GetComponent<RectTransform>().DOPivot(new Vector2(1,1), duration);
    }

    private void OnClicked()
    {
        if(!isActivated)
            return;
        GameServer.instance.SendCommand(new GameStart());
    }
}
